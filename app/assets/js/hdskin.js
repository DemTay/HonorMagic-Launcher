const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Type } = require('helios-distribution-types')
const { skinDimensions } = require('./skinmodel')

function supportsHdSkins(server) {
    return server.rawServer.id === 'Honor&Magic-1.12.2' &&
        server.rawServer.minecraftVersion === '1.12.2' &&
        Boolean(server.rawServer.address) &&
        server.modules.some(({ rawModule }) => rawModule.type === Type.ForgeMod &&
            /^net\.demtay\.mods:honormagicskins:1\.0\.0@jar$/.test(rawModule.id) &&
            rawModule.required?.value !== false)
}

function canRelayHdSkin(bytes) {
    return bytes.length >= 24 &&
        bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a &&
        bytes.readUInt32BE(8) === 13 && bytes.readUInt32BE(12) === 0x49484452 &&
        bytes.readUInt32BE(16) > 64 && skinDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
}

function prepareHdSkinLaunch(skin, address, baseEnv = process.env) {
    const env = { ...baseEnv }
    delete env.HM_HD_SKIN_FILE
    delete env.HM_HD_SKIN_VARIANT
    delete env.HM_HD_SKIN_SERVER
    if (!skin) return { env, cleanup() {} }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'honormagic-skin-'))
    const filename = path.join(directory, 'skin.png')
    const cleanup = () => fs.rmSync(directory, { recursive: true, force: true })
    try {
        fs.writeFileSync(filename, skin.bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
        cleanup()
        throw error
    }
    env.HM_HD_SKIN_FILE = filename
    env.HM_HD_SKIN_VARIANT = skin.variant
    env.HM_HD_SKIN_SERVER = address
    return { env, cleanup }
}

module.exports = { supportsHdSkins, canRelayHdSkin, prepareHdSkinLaunch }
