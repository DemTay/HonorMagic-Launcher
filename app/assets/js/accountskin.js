const got = require('got')
const { randomUUID } = require('node:crypto')

const profileUrl = 'https://api.minecraftservices.com/minecraft/profile'

function activeSkin(profile) {
    const active = profile.skins?.find(skin => skin.state === 'ACTIVE')
    if (!active) return null
    const url = new URL(active.url)
    if (url.hostname !== 'textures.minecraft.net' || !/^\/texture\/[0-9a-f]+$/i.test(url.pathname)) {
        throw new Error('L’adresse de texture reçue de Minecraft est invalide.')
    }
    return {
        url: 'https://textures.minecraft.net' + url.pathname,
        variant: active.variant?.toLowerCase() === 'slim' ? 'slim' : 'classic'
    }
}

function sameSkin(first, second) {
    return first?.url === second?.url && first?.variant === second?.variant
}

function uploadOptions(bytes, variant) {
    const boundary = randomUUID()
    return {
        headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
        body: Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${variant}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`),
            bytes,
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ])
    }
}

module.exports = function accountSkinService(library) {
    const textures = got.extend({ timeout: { request: 8000 }, retry: { limit: 0 }, followRedirect: false })
    let pending = Promise.resolve()

    async function synchronize(account, selection) {
        const api = textures.extend({ headers: { authorization: 'Bearer ' + account.accessToken } })
        const current = activeSkin(await api.get(profileUrl).json())
        const saved = library.getAccountSkin(account.uuid)
        const owned = saved?.applied && sameSkin(saved.applied, current)
        const original = owned ? saved.original : current
        let applied = owned ? saved.applied : null
        const stateChanged = !saved || !sameSkin(saved.original, original) || !sameSkin(saved.applied, applied)
        if (stateChanged) library.saveAccountSkin(account.uuid, { original, applied })

        if (selection?.variant) {
            const id = selection.id ?? null
            if (owned && applied.id === id && applied.variant === selection.variant) return original
            if (!id && !owned && original?.variant === selection.variant) return original
            const source = id ? library.readSkin(id) : original ? await textures.get(original.url).buffer() : await selection.defaultTexture()
            const bytes = selection.prepareTexture ? await selection.prepareTexture(source, original?.variant) : source
            const result = await api.post(profileUrl + '/skins', uploadOptions(bytes, selection.variant)).json()
            applied = activeSkin(result)
            if (!applied) throw new Error('Minecraft n’a pas confirmé le skin actif.')
            library.saveAccountSkin(account.uuid, { original, applied: { ...applied, id } })
        } else if (selection && owned) {
            if (original) {
                const image = await textures.get(original.url).buffer()
                await api.post(profileUrl + '/skins', uploadOptions(image, original.variant))
            } else {
                await api.delete(profileUrl + '/skins/active')
            }
            library.saveAccountSkin(account.uuid, { original, applied: null })
        }
        return original
    }

    return {
        synchronize(account, selection) {
            const task = pending.then(() => synchronize(account, selection))
            pending = task.catch(() => {})
            return task
        },
        readTexture(skin) {
            return textures.get(skin.url).buffer()
        }
    }
}
