// The catalog the mod sees with the Meme Factory server: built-in + server templates, deduped.
import { writeFileSync } from 'node:fs'
import * as lib from '../hooks/lib.js'
const H = { headers: { 'X-Meme-Factory': lib.FACTORY_CLIENT_KEY } }
const srv = await (await fetch(`${lib.FACTORY_SERVER}/templates/`, H)).json()
const up = await (await fetch('https://api.memegen.link/templates/')).json()
lib.addTemplates(lib.serverCandidates(srv, undefined, up).filter((t) => t.core))
const keep = ['id', 'name', 'lines', 'shape', 'core', 'slots', 'face', 'small', 'avoid', 'aliases', 'example', 'rank', 'source']
const out = [...lib.TEMPLATE_BY_ID.values()].map((t) => Object.fromEntries(keep.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])))
writeFileSync(new URL('./catalog.json', import.meta.url), JSON.stringify(out, null, 0))
console.log(out.length, 'templates')
