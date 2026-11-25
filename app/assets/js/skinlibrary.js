const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')

module.exports = function skinLibrary(directory, defaultEntry) {
    const index = path.join(directory, 'collection.json')
    const imagePath = id => {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Identifiant de skin invalide')
        return path.join(directory, id + '.png')
    }
    function read() {
        fs.mkdirSync(directory, { recursive: true })
        if (!fs.existsSync(index)) return { entries: [defaultEntry], active: defaultEntry.id }
        const collection = JSON.parse(fs.readFileSync(index, 'utf8'))
        collection.entries = [defaultEntry, ...collection.entries.filter(entry => entry.palette == null && entry.id !== defaultEntry.id)]
        if (!collection.entries.some(entry => entry.id === collection.active)) collection.active = defaultEntry.id
        return collection
    }
    function save(collection) {
        const temporary = index + '.' + randomUUID() + '.tmp'
        try {
            fs.writeFileSync(temporary, JSON.stringify({
                ...collection,
                entries: collection.entries.filter(entry => entry.id !== defaultEntry.id)
            }, null, 2), { flag: 'wx' })
            fs.renameSync(temporary, index)
        } finally {
            fs.rmSync(temporary, { force: true })
        }
    }
    function requireUniqueName(entries, name, id) {
        const normalized = name.trim().normalize('NFC').toLowerCase()
        if (entries.some(entry => entry.id !== id && entry.name.trim().normalize('NFC').toLowerCase() === normalized)) {
            const error = new Error('Ce nom de skin est déjà utilisé. Choisis un autre nom.')
            error.code = 'DUPLICATE_SKIN_NAME'
            throw error
        }
    }
    return {
        load() {
            const collection = read()
            for (const entry of collection.entries) {
                if (entry.id !== defaultEntry.id) entry.source = pathToFileURL(imagePath(entry.id)).href
            }
            return collection
        },
        add(entry, bytes) {
            const collection = read()
            requireUniqueName(collection.entries, entry.name)
            const file = imagePath(entry.id)
            fs.writeFileSync(file, bytes, { flag: 'wx' })
            try {
                collection.entries.push({ id: entry.id, name: entry.name, favorite: false, order: entry.order, variant: entry.variant })
                collection.active = entry.id
                save(collection)
            } catch (error) {
                fs.unlinkSync(file)
                throw error
            }
            return pathToFileURL(file).href
        },
        update(id, changes) {
            if (id === defaultEntry.id) throw new Error('Le skin du compte est protégé')
            const collection = read()
            const entry = collection.entries.find(item => item.id === id)
            if (!entry) throw new Error('Skin introuvable')
            if (changes.name !== undefined) requireUniqueName(collection.entries, changes.name, id)
            Object.assign(entry, changes)
            save(collection)
        },
        select(id) {
            const collection = read()
            if (!collection.entries.some(entry => entry.id === id)) throw new Error('Skin introuvable')
            collection.active = id
            save(collection)
        },
        remove(id) {
            if (id === defaultEntry.id) throw new Error('Le skin du compte est protégé')
            const collection = read()
            const entry = collection.entries.find(item => item.id === id)
            if (!entry) return
            collection.entries = collection.entries.filter(item => item.id !== id)
            if (collection.active === id) collection.active = defaultEntry.id
            save(collection)
            fs.rmSync(imagePath(id), { force: true })
        },
        getAccountSkin(uuid) {
            return read().accountSkins?.[uuid] ?? null
        },
        saveAccountSkin(uuid, state) {
            const collection = read()
            collection.accountSkins ??= {}
            collection.accountSkins[uuid] = state
            save(collection)
        },
        getAccountArmVariant(uuid) {
            return read().accountArmVariants?.[uuid]
        },
        setAccountArmVariant(uuid, variant) {
            const collection = read()
            collection.accountArmVariants ??= {}
            if (variant) collection.accountArmVariants[uuid] = variant
            else delete collection.accountArmVariants[uuid]
            save(collection)
        },
        readSkin(id) {
            return fs.readFileSync(imagePath(id))
        }
    }
}
