const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { Type } = require('helios-distribution-types')
const { supportsHdSkins, canRelayHdSkin, prepareHdSkinLaunch } = require('../app/assets/js/hdskin')
const { skinDimensions } = require('../app/assets/js/skinmodel')

test('only the Honor & Magic instance with the required Forge addon uses the HD path', () => {
    const rawServer = { id: 'Honor&Magic-1.12.2', minecraftVersion: '1.12.2', address: 'build.honor-magic.fr' }
    const rawModule = { id: 'net.demtay.mods:honormagicskins:1.0.0@jar', type: Type.ForgeMod }
    assert.equal(supportsHdSkins({ rawServer, modules: [] }), false)
    assert.equal(supportsHdSkins({ rawServer, modules: [{ rawModule }] }), true)
    assert.equal(supportsHdSkins({ rawServer: { ...rawServer, id: 'other' }, modules: [{ rawModule }] }), false)
    assert.equal(supportsHdSkins({ rawServer, modules: [{ rawModule: { ...rawModule, required: { value: false } } }] }), false)
})

test('keeps standard formats and limits new imports and HD relay to 128 pixels', () => {
    const bytes = Buffer.alloc(24)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
    bytes.writeUInt32BE(13, 8)
    bytes.write('IHDR', 12)
    for (const [width, height, valid] of [[64, 32, true], [64, 64, true], [128, 64, true], [128, 128, true], [128, 256, false], [256, 128, false], [256, 256, false], [96, 96, false]]) {
        bytes.writeUInt32BE(width, 16)
        bytes.writeUInt32BE(height, 20)
        assert.equal(skinDimensions(width, height), valid)
        assert.equal(canRelayHdSkin(bytes), valid && width === 128)
    }
    assert.equal(canRelayHdSkin(Buffer.alloc(24)), false)
})

test('exposes only the selected HD file to Minecraft and removes the temporary copy', () => {
    const inherited = { PATH: 'java', HM_HD_SKIN_FILE: 'unrelated.png', HM_HD_SKIN_SERVER: 'unrelated', HM_HD_SKIN_VARIANT: 'slim' }
    assert.deepEqual(prepareHdSkinLaunch(null, null, inherited).env, { PATH: 'java' })
    const bytes = Buffer.from('fixture')
    const { env, cleanup } = prepareHdSkinLaunch({ bytes, variant: 'classic' }, 'build.honor-magic.fr', inherited)
    try {
        assert.deepEqual(fs.readFileSync(env.HM_HD_SKIN_FILE), bytes)
        assert.equal(env.HM_HD_SKIN_VARIANT, 'classic')
        assert.equal(env.HM_HD_SKIN_SERVER, 'build.honor-magic.fr')
        assert.equal(inherited.HM_HD_SKIN_FILE, 'unrelated.png')
    } finally {
        cleanup()
    }
    assert.equal(fs.existsSync(env.HM_HD_SKIN_FILE), false)
})
