const fs = require('node:fs')
const path = require('node:path')

function inside(root, value) {
    if (!value || !path.isAbsolute(value)) return false
    const relative = path.relative(root, value)
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function dataPaths(parent) {
    const root = path.join(parent, '.honor&magic')
    const legacy = path.join(parent, '.helioslauncher')
    const recovered = path.join(root, 'installation-helios')
    return {
        root, legacy, recovered, skins: path.join(root, 'skin'),
        migrate(config) {
            const launcher = config.settings.launcher
            const java = Object.values(config.javaConfig || {}).filter(Boolean)
            const usingLegacy = inside(legacy, launcher.dataDirectory) || java.some(item => inside(legacy, item.executable))
            if (!usingLegacy) return
            let destination = root
            if (fs.existsSync(legacy)) {
                if (fs.existsSync(root)) {
                    destination = recovered
                    if (fs.existsSync(destination)) throw new Error(`Destination déjà occupée : ${destination}`)
                }
                fs.renameSync(legacy, destination)
            } else if (fs.existsSync(recovered)) {
                destination = recovered
            }
            const relocate = value => inside(legacy, value) ? path.join(destination, path.relative(legacy, value)) : value
            launcher.dataDirectory = relocate(launcher.dataDirectory)
            for (const item of java) item.executable = relocate(item.executable)
        }
    }
}

module.exports = dataPaths
