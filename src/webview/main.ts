import { mount } from 'svelte'

import Browse from './Browse.svelte'

const target = document.getElementById('app')
if (target) mount(Browse, { target })
