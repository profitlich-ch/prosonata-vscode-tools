<script lang="ts">
  /*
   * The table of time entries (docs/adr/0001). It draws what the host sends and
   * sends back what someone wants done; nothing here decides what gets written.
   * Even the hours typed into a cell are only checked for their form before
   * they go — the host parses them again and plans the write.
   */
  import { onMount } from 'svelte'

  import {
    groupRows,
    keepSelection,
    matches,
    selectable,
    sumSeconds,
    type BrowseData,
    type BrowseRow,
    type Grouping,
    type MergePreview,
    type RowGroup,
    type SortKey,
    type ToHost,
    type ToView,
  } from '../core/browse-view.js'
  import { billedTime, EXACT, hoursAndMinutes, parseHours } from '../core/working-time.js'
  import { host as api } from './api.js'
  import { t, useStrings } from './l10n.js'

  const saved = api.getState()

  let data = $state<BrowseData | null>(null)
  let locale = $state('en')
  let busy = $state(false)

  let query = $state(saved?.query ?? '')
  let grouping = $state<Grouping>(saved?.grouping ?? 'branch')
  let showInvoiced = $state(saved?.showInvoiced ?? false)
  let sortKey = $state<SortKey>(saved?.sortKey ?? 'date')
  let direction = $state<1 | -1>(saved?.direction ?? -1)
  let selected = $state<number[]>(saved?.selected ?? [])

  let preview = $state<MergePreview | null>(null)
  /** Why there is no preview although several rows are ticked, from the host. */
  let previewReason = $state<string | null>(null)
  /** The entry chosen to stay; undefined leaves it to the host, which takes the oldest. */
  let keepChoice = $state<number | undefined>(undefined)
  let merging = $state<{ text: string; hours: string; invalid: boolean } | null>(null)
  let editing = $state<{ timeID: number; field: 'text' | 'hours'; value: string; start: string } | null>(null)
  let failure = $state<{ message: string; timeID?: number; field?: 'text' | 'hours' } | null>(null)

  const rows = $derived(data?.rows ?? [])
  const visible = $derived(rows.filter((row) => (showInvoiced || !row.invoiced) && matches(row, query)))
  const groups = $derived(groupRows(visible, grouping, sortKey, direction))
  const picked = $derived(rows.filter((row) => selected.includes(row.timeID)))
  const invoicedRows = $derived(rows.filter((row) => row.invoiced))
  // An open entry is created anew by its branch's next write, so deleting it undoes itself.
  const deletable = $derived(picked.filter((row) => !row.open))
  const openSeconds = $derived(sumSeconds(rows) - sumSeconds(invoicedRows))

  function send(message: ToHost): void {
    api.postMessage(message)
  }

  onMount(() => {
    const receive = (event: MessageEvent<ToView>) => handle(event.data)
    window.addEventListener('message', receive)
    send({ kind: 'ready' })
    return () => window.removeEventListener('message', receive)
  })

  function handle(message: ToView): void {
    switch (message.kind) {
      case 'show':
        useStrings(message.strings)
        locale = message.locale
        data = message.data
        if (editing && !message.data.rows.some((row) => row.timeID === editing?.timeID && !row.invoiced)) editing = null
        {
          const kept = keepSelection(selected, message.data.rows)
          // A changed selection asks for its preview by itself (the effect
          // below); an unchanged one asks again, since its hours may have moved.
          if (!sameIds(kept, selected)) selected = kept
          else if (kept.length >= 2) send({ kind: 'preview', ids: kept, ...(keepChoice === undefined ? {} : { keep: keepChoice }) })
        }
        break
      case 'busy':
        busy = message.busy
        break
      case 'preview':
        // An answer to a selection that has changed since is of no use.
        if (sameIds(message.ids, selected)) {
          preview = message.preview
          previewReason = message.reason ?? null
          if (!preview) merging = null
        }
        break
      case 'failed':
        failure = message
        break
      case 'saved':
        if (editing?.timeID === message.timeID) editing = null
        failure = null
        break
      case 'merged':
        merging = null
        selected = []
        failure = null
        break
    }
  }

  // Kept while the tab is hidden, when VS Code throws the page away.
  $effect(() => {
    api.setState({ query, grouping, showInvoiced, sortKey, direction, selected: [...selected] })
  })

  // A merge is planned in the host; ask again whenever the ticked rows change.
  $effect(() => {
    const ids = [...selected]
    merging = null
    preview = null
    previewReason = null
    keepChoice = undefined
    if (ids.length >= 2) send({ kind: 'preview', ids })
  })

  // The sums do not change with the entry that stays, the plan does: ask again.
  function chooseKeep(timeID: number): void {
    keepChoice = timeID
    send({ kind: 'preview', ids: [...selected], keep: timeID })
  }

  function sameIds(a: number[], b: number[]): boolean {
    const [x, y] = [[...a].sort(), [...b].sort()]
    return x.length === y.length && x.every((id, index) => id === y[index])
  }

  function toggle(row: BrowseRow, on: boolean): void {
    selected = on ? [...selected, row.timeID] : selected.filter((id) => id !== row.timeID)
  }

  function toggleGroup(group: RowGroup, on: boolean): void {
    const ids = selectable(group.rows).map((row) => row.timeID)
    selected = on ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id))
  }

  function groupState(group: RowGroup): 'all' | 'some' | 'none' {
    const ids = selectable(group.rows).map((row) => row.timeID)
    const ticked = ids.filter((id) => selected.includes(id)).length
    return ticked === 0 ? 'none' : ticked === ids.length ? 'all' : 'some'
  }

  function sortBy(key: SortKey): void {
    direction = sortKey === key ? (direction === 1 ? -1 : 1) : -1
    sortKey = key
  }

  function arrow(key: SortKey): string {
    return sortKey !== key ? '' : direction === -1 ? '▼' : '▲'
  }

  function startEdit(row: BrowseRow, field: 'text' | 'hours'): void {
    if (row.invoiced || busy) return
    const value = field === 'text' ? row.text : row.hours
    editing = { timeID: row.timeID, field, value, start: value }
    failure = null
  }

  function commitEdit(): void {
    if (!editing) return
    if (editing.value === editing.start) {
      editing = null
      return
    }
    if (editing.field === 'hours' && parseHours(editing.value) === null) {
      failure = { message: t('1:30 or 1.5'), timeID: editing.timeID, field: 'hours' }
      return
    }
    send({ kind: 'edit', timeID: editing.timeID, field: editing.field, value: editing.value })
  }

  function editKeys(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      editing = null
      failure = null
    }
  }

  function typed(event: Event & { currentTarget: HTMLInputElement }): void {
    if (editing) editing.value = event.currentTarget.value
  }

  // A field left without a change closes; one with a change stays open, so a
  // stray click never writes to an invoice and never throws a typed value away.
  function leaveEdit(): void {
    if (editing && editing.value === editing.start) editing = null
  }

  function openMerge(): void {
    if (preview) merging = { text: preview.text, hours: preview.proposed, invalid: false }
  }

  function confirmMerge(): void {
    if (!merging || !preview) return
    if (parseHours(merging.hours) === null) {
      merging = { ...merging, invalid: true }
      return
    }
    send({ kind: 'merge', ids: preview.ids, keep: preview.keep, text: merging.text, hours: merging.hours })
  }

  function focus(node: HTMLInputElement): void {
    node.focus()
    node.select()
  }

  function mixed(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value
    return { update: (next: boolean) => (node.indeterminate = next) }
  }

  function day(date: string): string {
    return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  /** Sums in the same notation as the rows, which come from the host. */
  function clock(seconds: number): string {
    return billedTime(seconds, EXACT)
  }

  function groupName(group: RowGroup): string {
    if (grouping === 'week') return t('Week {0}', Number(group.key.slice(6)))
    return group.key
  }
</script>

<main class:busy>
  <div class="progress" aria-hidden="true"></div>

  {#if !data}
    <p class="empty">{t('Fetching time entries …')}</p>
  {:else}
    <header class="head">
      <div class="title">
        <h1>{data.project}</h1>
        <p class="sub">
          {t('My entries: {0} h open · {1} h invoiced', clock(openSeconds), clock(sumSeconds(invoicedRows)))}
        </p>
      </div>
      {#if data.budget && data.budget.planned > 0}
        <div class="budget">
          <div class="budget-row"><span>{t('Budget of the project')}</span><b>{data.budget.text}</b></div>
          <div
            class="bar"
            class:over={data.budget.needed > data.budget.planned}
            role="meter"
            aria-label={t('Budget of the project')}
            aria-valuemin={0}
            aria-valuemax={data.budget.planned}
            aria-valuenow={data.budget.needed}
          >
            <i style:width="{Math.min(100, (data.budget.needed / data.budget.planned) * 100)}%"></i>
          </div>
        </div>
      {/if}
      <div class="meta">
        <span>{t('Rounding grid')} <b>{data.grid}</b></span>
        <button type="button" class="secondary" onclick={() => send({ kind: 'refresh' })} disabled={busy}>
          {t('Reload')}
        </button>
      </div>
    </header>

    <div class="toolbar">
      <input
        class="search"
        type="search"
        bind:value={query}
        placeholder={t('Search text, #number or branch')}
        aria-label={t('Search')}
      />
      <span class="label" id="grouping-label">{t('Group by')}</span>
      <div class="segmented" role="group" aria-labelledby="grouping-label">
        <button type="button" aria-pressed={grouping === 'branch'} onclick={() => (grouping = 'branch')}>{t('Branch')}</button>
        <button type="button" aria-pressed={grouping === 'week'} onclick={() => (grouping = 'week')}>{t('Week')}</button>
        <button type="button" aria-pressed={grouping === 'none'} onclick={() => (grouping = 'none')}>{t('nothing')}</button>
      </div>
      {#if invoicedRows.length > 0}
        <label class="check">
          <input type="checkbox" bind:checked={showInvoiced} />
          {t('Show invoiced ({0})', invoicedRows.length)}
        </label>
      {/if}
    </div>

    {#if failure && failure.field === undefined}
      <div class="banner" role="alert">
        <span>{failure.message}</span>
        <button type="button" class="secondary" onclick={() => (failure = null)}>{t('Dismiss')}</button>
      </div>
    {/if}

    {#if merging && preview}
      <section class="drawer" aria-labelledby="merge-title">
        <h2 id="merge-title">{t('Merge {0} entries into #{1}', preview.members.length, preview.keep)}</h2>
        <div class="compare">
          <div>
            <small>{t('rounded per entry')}</small>
            <strong class:struck={preview.recomputed !== null && preview.recomputed !== preview.added}>{preview.added} h</strong>
          </div>
          {#if preview.recomputed !== null}
            <div><small>{t('rounded once')}</small><strong>{preview.recomputed} h</strong></div>
          {/if}
          <div><small>{t('Date')}</small><strong>{day(preview.date)}</strong></div>
        </div>
        <p class="note">{preview.note}</p>
        <div class="fields">
          <label>
            {t('Text on the invoice')}
            <input type="text" bind:value={merging.text} />
          </label>
          <label>
            {t('Hours')}
            <input type="text" bind:value={merging.hours} aria-invalid={merging.invalid} />
            {#if merging.invalid}<span class="error">{t('1:30 or 1.5')}</span>{/if}
          </label>
        </div>
        <fieldset class="members">
          <legend>{t('Which entry stays')}</legend>
          {#each preview.members as member (member.timeID)}
            {@const stays = member.timeID === preview.keep}
            <label class="member" class:stays>
              <input
                type="radio"
                name="keep"
                checked={stays}
                disabled={preview.keepFixed || busy}
                onchange={() => chooseKeep(member.timeID)}
              />
              <span class="mono">#{member.timeID}</span>
              <span>{day(member.date)}</span>
              <span class="num">{member.hours} h</span>
              <span class="member-text">
                {#if member.text}{member.text}{:else}<span class="unknown">{t('(no text)')}</span>{/if}
              </span>
              {#if member.open}<span class="chip">{t('open')}</span>{/if}
              <span class="status">{stays ? t('stays') : t('is deleted')}</span>
            </label>
          {/each}
          {#if preview.keepFixed}
            <p class="note">{t('The open entry stays: its branch still writes to it.')}</p>
          {/if}
        </fieldset>
        <div class="actions">
          <button type="button" onclick={confirmMerge} disabled={busy}>{t('Merge')}</button>
          <button type="button" class="secondary" onclick={() => (merging = null)}>{t('Cancel')}</button>
        </div>
      </section>
    {/if}

    {#if rows.length === 0}
      <p class="empty">{t('This project has no time entries yet.')}</p>
    {:else if visible.length === 0}
      <p class="empty">{t('No entry matches.')}</p>
    {:else}
      <div class="table">
        <table>
          <thead>
            <tr>
              <th class="tick"><span class="hidden">{t('Selection')}</span></th>
              <th><button type="button" class="sort" onclick={() => sortBy('date')}>{t('Date')} {arrow('date')}</button></th>
              <th>{t('Text on the invoice')}</th>
              <th class="num"><button type="button" class="sort" onclick={() => sortBy('hours')}>{t('Hours')} {arrow('hours')}</button></th>
              {#if grouping !== 'branch'}<th>{t('Branch')}</th>{/if}
              <th title={t('What the segment log on this computer measured into the entry')}>{t('Measured')}</th>
              <th>{t('Notes')}</th>
              <th class="num"><button type="button" class="sort" onclick={() => sortBy('id')}>{t('No.')} {arrow('id')}</button></th>
            </tr>
          </thead>
          {#each groups as group (group.key)}
            <tbody>
              {#if grouping !== 'none'}
                {@const ticked = groupState(group)}
                <tr class="group">
                  <td class="tick">
                    {#if selectable(group.rows).length > 0}
                      <input
                        type="checkbox"
                        checked={ticked === 'all'}
                        use:mixed={ticked === 'some'}
                        aria-label={t('Select group {0}', groupName(group) || t('without branch'))}
                        onchange={(event) => toggleGroup(group, event.currentTarget.checked)}
                      />
                    {/if}
                  </td>
                  <td colspan={grouping === 'branch' ? 6 : 7}>
                    {#if group.key === ''}
                      <span class="unknown">{t('Without branch — entered in ProSonata or on another computer')}</span>
                    {:else}
                      <span class:mono={grouping === 'branch'}>{groupName(group)}</span>
                    {/if}
                    <span class="sum">
                      {group.rows.length === 1
                        ? t('one entry · {0} h', clock(group.seconds))
                        : t('{0} entries · {1} h', group.rows.length, clock(group.seconds))}
                    </span>
                  </td>
                </tr>
              {/if}
              {#each group.rows as row (row.timeID)}
                {@const isEditing = editing?.timeID === row.timeID ? editing : null}
                {@const rowFailure = failure?.timeID === row.timeID ? failure : null}
                <tr class="row" class:selected={selected.includes(row.timeID)} class:invoiced={row.invoiced}>
                  <td class="tick">
                    {#if !row.invoiced}
                      <input
                        type="checkbox"
                        checked={selected.includes(row.timeID)}
                        aria-label={t('Select #{0}', row.timeID)}
                        onchange={(event) => toggle(row, event.currentTarget.checked)}
                      />
                    {/if}
                  </td>
                  <td class="date">{day(row.date)}</td>
                  <td class="text">
                    {#if isEditing?.field === 'text'}
                      <input
                        type="text"
                        value={isEditing.value}
                        oninput={typed}
                        use:focus
                        onkeydown={editKeys}
                        onblur={leaveEdit}
                        disabled={busy}
                        aria-label={t('Text on the invoice')}
                      />
                      {#if rowFailure?.field === 'text'}<span class="error">{rowFailure.message}</span>{/if}
                    {:else}
                      <button
                        type="button"
                        class="cell"
                        disabled={row.invoiced}
                        aria-label={t('Change text of #{0}', row.timeID)}
                        onclick={() => startEdit(row, 'text')}
                      >
                        {#if row.text}{row.text}{:else}<span class="unknown">{t('(no text)')}</span>{/if}
                      </button>
                    {/if}
                  </td>
                  <td class="num">
                    {#if isEditing?.field === 'hours'}
                      <input
                        type="text"
                        class="hours"
                        value={isEditing.value}
                        oninput={typed}
                        use:focus
                        onkeydown={editKeys}
                        onblur={leaveEdit}
                        disabled={busy}
                        aria-label={t('Hours')}
                        aria-invalid={rowFailure?.field === 'hours'}
                      />
                      {#if rowFailure?.field === 'hours'}<span class="error">{rowFailure.message}</span>{/if}
                    {:else}
                      <button
                        type="button"
                        class="cell"
                        disabled={row.invoiced}
                        aria-label={t('Change hours of #{0}', row.timeID)}
                        onclick={() => startEdit(row, 'hours')}
                      >
                        {row.hours}
                      </button>
                    {/if}
                  </td>
                  {#if grouping !== 'branch'}
                    <td>{#if row.branch}<span class="mono">{row.branch}</span>{:else}<span class="unknown">—</span>{/if}</td>
                  {/if}
                  <td>
                    {#if row.measured !== null}
                      <span class="covered">✓ {hoursAndMinutes(row.measured)}</span>
                    {:else}
                      <span class="unknown" title={t('No segment on this computer knows this entry')}>—</span>
                    {/if}
                  </td>
                  <td class="chips">
                    {#if row.invoiced}<span class="chip">{t('invoiced')}</span>{/if}
                    {#if row.open}<span class="chip">{t('open')}</span>{/if}
                    {#if row.duplicate}<span class="chip warn">{t('possible duplicate')}</span>{/if}
                    {#if row.notInvoiceable}<span class="chip">{t('not billable')}</span>{/if}
                  </td>
                  <td class="num mono">#{row.timeID}</td>
                </tr>
              {/each}
            </tbody>
          {/each}
        </table>
      </div>
    {/if}

    <footer class="selection">
      {#if picked.length === 0}
        <span class="hint">{t('Tick entries to merge or delete them.')}</span>
      {:else}
        <span><b>{t('{0} selected · {1} h', picked.length, clock(sumSeconds(picked)))}</b></span>
        {#if preview}
          <span class="hint">
            {preview.recomputed !== null
              ? t('merged {0} h, rounded once', preview.recomputed)
              : t('merged {0} h, added up from ProSonata', preview.added)}
          </span>
        {:else if previewReason}
          <span class="hint warn">{previewReason}</span>
        {/if}
      {/if}
      <span class="spacer"></span>
      <button type="button" onclick={openMerge} disabled={busy || !preview || merging !== null}>{t('Merge')}</button>
      <button
        type="button"
        class="secondary"
        onclick={() => send({ kind: 'remove', ids: [...selected] })}
        disabled={busy || deletable.length === 0}
        title={picked.length > 0 && deletable.length === 0 ? t('Open entries cannot be deleted here.') : undefined}
      >
        {t('Delete')}
      </button>
    </footer>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }

  main {
    display: grid;
    gap: 12px;
    padding: 12px 20px 0;
    align-content: start;
    font-variant-numeric: tabular-nums;
  }

  .progress {
    position: fixed;
    inset: 0 0 auto;
    height: 2px;
    background: var(--vscode-progressBar-background);
    opacity: 0;
  }
  .busy .progress {
    opacity: 1;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 32px;
    align-items: flex-end;
  }
  h1 {
    margin: 0;
    font-size: 1.25em;
    font-weight: 600;
  }
  h2 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
  .sub,
  .label,
  .hint,
  .note,
  small {
    color: var(--vscode-descriptionForeground);
  }
  .sub {
    margin: 2px 0 0;
  }
  .budget {
    display: grid;
    gap: 4px;
    min-width: 200px;
    flex: 1;
    max-width: 340px;
  }
  .budget-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .budget-row b {
    color: var(--vscode-foreground);
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--vscode-input-background);
    outline: 1px solid var(--vscode-widget-border, transparent);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--vscode-progressBar-background);
  }
  .bar.over i {
    background: var(--vscode-editorWarning-foreground);
  }
  .meta {
    display: flex;
    gap: 16px;
    align-items: center;
    color: var(--vscode-descriptionForeground);
  }
  .meta b {
    color: var(--vscode-foreground);
    font-weight: 500;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }

  input[type='text'],
  input[type='search'] {
    box-sizing: border-box;
    font: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 3px 6px;
  }
  input:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  input[aria-invalid='true'] {
    border-color: var(--vscode-inputValidation-errorBorder);
  }
  .search {
    width: 260px;
    max-width: 100%;
  }
  input[type='checkbox'] {
    accent-color: var(--vscode-button-background);
    margin: 0;
  }
  .check {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  button {
    font: inherit;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    padding: 3px 12px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.secondary:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .segmented {
    display: inline-flex;
  }
  .segmented button {
    color: var(--vscode-foreground);
    background: transparent;
    border-color: var(--vscode-input-border, var(--vscode-widget-border, transparent));
    border-radius: 0;
  }
  .segmented button + button {
    border-left-width: 0;
  }
  .segmented button[aria-pressed='true'] {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }

  .banner {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    margin: 0;
    padding: 6px 10px;
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    background: var(--vscode-inputValidation-errorBackground);
  }
  .error {
    display: block;
    font-size: 0.9em;
    color: var(--vscode-errorForeground);
  }

  .drawer {
    display: grid;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, transparent));
    background: var(--vscode-editorWidget-background);
  }
  .compare {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 28px;
  }
  .compare div {
    display: grid;
  }
  .compare strong {
    font-size: 1.3em;
    font-weight: 600;
  }
  .struck {
    text-decoration: line-through;
    color: var(--vscode-descriptionForeground);
  }
  .note {
    margin: 0;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px;
    gap: 10px;
  }
  .fields label {
    display: grid;
    gap: 4px;
  }
  .fields input {
    width: 100%;
  }
  .members {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .members legend {
    padding: 0 0 4px;
    color: var(--vscode-descriptionForeground);
  }
  .member {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 2px 4px;
    border-radius: 2px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
  }
  .member.stays {
    color: var(--vscode-foreground);
    background: var(--vscode-list-inactiveSelectionBackground);
  }
  .member-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    font-size: 0.9em;
  }
  .hint.warn {
    color: var(--vscode-editorWarning-foreground);
  }
  .actions {
    display: flex;
    gap: 8px;
  }

  .table {
    overflow-x: auto;
    margin: 0 -20px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 760px;
  }
  th,
  td {
    text-align: left;
    padding: 0 8px;
    height: 26px;
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    padding-left: 20px;
    width: 22px;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    font-size: 0.85em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border));
  }
  .num {
    text-align: right;
  }
  .sort {
    all: unset;
    cursor: pointer;
  }
  .sort:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
  }
  /*
   * Mixed from the text colour rather than taken from a theme colour: the
   * section-header colours sit within a shade of the editor background in the
   * dark default themes, and the group row is what the eye scans for.
   */
  .group td {
    height: 30px;
    font-weight: 600;
    background: color-mix(in srgb, var(--vscode-foreground) 8%, var(--vscode-editor-background));
    border-top: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border));
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border));
  }
  .sum {
    margin-left: 10px;
    font-weight: 400;
    color: var(--vscode-descriptionForeground);
  }
  .row:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .row.selected {
    background: var(--vscode-list-inactiveSelectionBackground);
  }
  .row.invoiced td {
    color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
  }
  td.text {
    white-space: normal;
    min-width: 240px;
    width: 50%;
  }
  td.text input {
    width: 100%;
  }
  input.hours {
    width: 70px;
    text-align: right;
  }
  .cell {
    all: unset;
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin: 0 -4px;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: text;
  }
  .num .cell {
    text-align: right;
  }
  .cell:hover:not(:disabled) {
    border-color: var(--vscode-input-border, var(--vscode-widget-border));
  }
  .cell:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
  }
  .cell:disabled {
    cursor: default;
  }
  .mono {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
  }
  .unknown {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .covered {
    color: var(--vscode-testing-iconPassed, var(--vscode-foreground));
  }
  .chip {
    display: inline-block;
    margin-right: 4px;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 0.85em;
    line-height: 1.6;
    color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
  }
  .chip.warn {
    color: var(--vscode-editor-background);
    background: var(--vscode-editorWarning-foreground);
  }
  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .empty {
    color: var(--vscode-descriptionForeground);
  }

  .selection {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
    margin: 0 -20px;
    padding: 8px 20px;
    border-top: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border));
    background: var(--vscode-editorWidget-background);
  }
  .spacer {
    flex: 1;
  }
</style>
