const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const createLibrary = require('../app/assets/js/skinlibrary')
const childProcess = require('node:child_process')

const official = { id: 'account-skin', name: 'Par défaut', favorite: false, order: -1 }
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-skins-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    return { directory, open: () => createLibrary(directory, official) }
}

test('all wardrobe operations survive reopening', t => {
    const { directory, open } = fixture(t)
    const id = randomUUID()
    open().add({ id, name: 'Étoile', order: 0, variant: 'slim' }, image)
    open().update(id, { name: 'Étoile bleue', favorite: true, variant: 'classic' })
    const state = { original: { url: 'https://textures.minecraft.net/texture/abc', variant: 'slim' }, applied: { id, variant: 'classic' } }
    open().saveAccountSkin('account', state)
    open().setAccountArmVariant('account', 'slim')
    const saved = open().load()
    assert.equal(saved.active, id)
    assert.deepEqual(saved.entries.map(({ source: _source, ...entry }) => entry), [official, {
        id, name: 'Étoile bleue', order: 0, variant: 'classic', favorite: true
    }])
    assert.deepEqual(open().readSkin(id), image)
    assert.deepEqual(open().getAccountSkin('account'), state)
    assert.equal(open().getAccountArmVariant('account'), 'slim')
    assert.throws(() => open().add({ id: randomUUID(), name: ' ÉTOILE BLEUE ' }, image), { code: 'DUPLICATE_SKIN_NAME' })
    assert.throws(() => open().remove(official.id), /protégé/)
    open().select(official.id)
    assert.equal(open().load().active, official.id)
    open().select(id)
    open().remove(id)
    assert.deepEqual(open().load().entries, [official])
    assert.equal(open().load().active, official.id)
    assert.deepEqual(open().getAccountSkin('account'), state)
    open().setAccountArmVariant('account', null)
    assert.equal(open().getAccountArmVariant('account'), undefined)
    assert.deepEqual(fs.readdirSync(directory), ['collection.json'])
})

test('existing collection preserves account state and original PNG', t => {
    const { directory, open } = fixture(t)
    const id = randomUUID()
    const entry = { id, name: 'Ancien', favorite: true, order: 4, variant: 'slim' }
    const collection = { entries: [entry], active: id, accountSkins: { account: { original: null, applied: null } }, accountArmVariants: { account: 'classic' } }
    fs.writeFileSync(path.join(directory, id + '.png'), image)
    fs.writeFileSync(path.join(directory, 'collection.json'), JSON.stringify(collection))
    assert.equal(open().load().active, id)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'collection.json'), 'utf8')), collection)
    assert.deepEqual(open().readSkin(id), image)
    assert.equal(fs.existsSync(path.join(directory, 'garde-robe.png')), false)
    assert.equal(open().load().entries[1].name, entry.name)
})

test('Windows hides existing indexes and reapplies the attribute after saving', t => {
    const { directory, open } = fixture(t)
    const calls = []
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    t.after(() => Object.defineProperty(process, 'platform', platform))
    t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
        calls.push({ command, args, options })
    })
    const file = path.join(directory, 'collection.json')
    open().select(official.id)
    open().load()
    open().select(official.id)
    assert.deepEqual(calls.map(call => call.args), [['+H', file], ['+H', file], ['-H', file], ['+H', file]])
    assert.ok(calls.every(call => call.command === 'attrib.exe' && call.options.windowsHide))
})

test('an attribute failure does not roll back a successfully saved import', t => {
    const { open } = fixture(t)
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    t.after(() => Object.defineProperty(process, 'platform', platform))
    t.mock.method(childProcess, 'execFileSync', () => { throw new Error('attrib unavailable') })
    t.mock.method(console, 'warn', () => {})
    const id = randomUUID()
    open().add({ id, name: 'Conservé', order: 0, variant: 'slim' }, image)
    assert.equal(open().load().active, id)
    assert.deepEqual(open().readSkin(id), image)
})
