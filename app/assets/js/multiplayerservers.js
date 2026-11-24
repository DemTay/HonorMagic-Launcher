const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const server = { name: 'Honor & Magic', ip: 'build.honor-magic.fr' }
const previousAddress = 'play.honor-magic.fr'

function normalizeAddress(address) {
    return typeof address === 'string'
        ? address.trim().toLowerCase().replace(/:25565$/, '').replace(/\.$/, '')
        : ''
}

function readIfPresent(file) {
    try {
        return fs.readFileSync(file)
    } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
    }
}

module.exports = async function addHonorMagicServer(gameDirectory) {
    const file = path.join(gameDirectory, 'servers.dat')
    const original = readIfPresent(file)
    const { NBTData, read, write } = await import('nbtify')
    const document = original
        ? await read(original, { endian: 'big', rootName: true, bedrockLevel: false })
        : new NBTData({})
    const { data } = document
    const entries = data.servers ?? []
    if (Array.isArray(data) || !Array.isArray(entries)) {
        throw new Error('Format de la liste multijoueur invalide.')
    }
    let hasServer = entries.some(({ ip }) => normalizeAddress(ip) === server.ip)
    let changed = false
    const nextEntries = []
    for (const entry of entries) {
        if (entry.name !== server.name || normalizeAddress(entry.ip) !== previousAddress) {
            nextEntries.push(entry)
            continue
        }

        changed = true
        if (!hasServer) {
            nextEntries.push({ ...entry, ip: server.ip })
            hasServer = true
        }
    }
    if (!hasServer) {
        nextEntries.push(server)
        changed = true
    }
    if (!changed) return

    // A vanilla empty list can have the End tag type. Infer the compound type from the new entries.
    data.servers = nextEntries
    const updated = await write(document)
    fs.mkdirSync(gameDirectory, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
        fs.writeFileSync(temporary, updated, { flag: 'wx' })
        const current = readIfPresent(file)
        if (!(original ? current?.equals(original) : current === null)) {
            throw new Error('La liste multijoueur a été modifiée pendant sa préparation.')
        }
        fs.renameSync(temporary, file)
    } finally {
        fs.rmSync(temporary, { force: true })
    }
}
