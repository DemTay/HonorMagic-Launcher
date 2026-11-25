const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const packName = 'Honor&Magic.zip'

function readOptions(file) {
    try {
        return fs.readFileSync(file, 'utf8')
    } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
    }
}

module.exports = function applyHonorMagicResourcePack(gameDirectory) {
    const marker = path.join(gameDirectory, '.hm-resource-pack-initialized')
    const pack = path.join(gameDirectory, 'resourcepacks', packName)
    if (fs.existsSync(marker) || !fs.statSync(pack, { throwIfNoEntry: false })?.isFile()) return

    const file = path.join(gameDirectory, 'options.txt')
    const original = readOptions(file)
    const options = original ?? ''
    const entries = [...options.matchAll(/^(\uFEFF?resourcePacks:)([^\r\n]*)/gm)]
    const entry = entries[0]
    const selected = entry ? JSON.parse(entry[2]) : []
    if (entries.length > 1 || !Array.isArray(selected) || !selected.every(name => typeof name === 'string')) {
        throw new Error('La liste des packs dans options.txt est invalide.')
    }

    if (!selected.includes(packName)) {
        const value = JSON.stringify([...selected, packName])
        const newline = options.includes('\r\n') ? '\r\n' : '\n'
        const updated = entry
            ? options.slice(0, entry.index) + entry[1] + value + options.slice(entry.index + entry[0].length)
            : options + (options && !options.endsWith('\n') ? newline : '') + 'resourcePacks:' + value + newline
        const temporary = `${file}.${randomUUID()}.tmp`
        try {
            fs.writeFileSync(temporary, updated, { flag: 'wx' })
            if (readOptions(file) !== original) {
                throw new Error('Les options Minecraft ont été modifiées pendant la préparation.')
            }
            fs.renameSync(temporary, file)
        } finally {
            fs.rmSync(temporary, { force: true })
        }
    }

    fs.writeFileSync(marker, '')
}
