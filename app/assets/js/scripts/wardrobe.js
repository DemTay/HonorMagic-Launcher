const { closeWardrobe, applyWardrobeSkin } = (() => {
    const canvas = document.querySelector('.skin')
    const {
        cosElevation,
        importedSole,
        paintSkin,
        enableSkinOrbit,
        buildGeometry,
        skinVariant,
        convertArmVariant,
        skinDimensions,
        accountSkinTexture
    } = require('./assets/js/skinmodel')
    const { supportsHdSkins, canRelayHdSkin } = require('./assets/js/hdskin')
    const homeName = document.querySelector('.fitting .skin-name')
    const homeContext = canvas.getContext('2d')
    let homeFaces = []
    let homeSole = 0
    const homeOrbit = enableSkinOrbit(
        canvas,
        (yaw) =>
            paintPreview(homeContext, homeFaces, yaw, homeSole),
        0.33
    )

    const wardrobe = document.querySelector('.wardrobe')
    const toggle = document.querySelector('.shortcut.shirt')
    const grid = wardrobe.querySelector('.wardrobe-grid')
    const stage = wardrobe.querySelector('canvas')
    const armSwitch = wardrobe.querySelector('.wardrobe-arm-switch')
    const name = wardrobe.querySelector('.wardrobe-name')
    const feedback = wardrobe.querySelector('.wardrobe-feedback')
    const addDialog = wardrobe.querySelector('#wardrobe-add-dialog')
    const addForm = addDialog.querySelector('form')
    const fileInput = addForm.elements.skinFile
    const addName = addForm.elements.skinName
    const addError = addDialog.querySelector('.wardrobe-add-error')
    const addSubmit = addDialog.querySelector('button[type=submit]')
    const addCancel = addDialog.querySelector('button[type=button]')
    const renameButton = wardrobe.querySelector('#wardrobe-rename')
    const deleteButton = wardrobe.querySelector('#wardrobe-delete')
    const renameDialog = wardrobe.querySelector('#wardrobe-rename-dialog')
    const deleteDialog = wardrobe.querySelector('#wardrobe-delete-dialog')
    const renameInput = renameDialog.querySelector('input')

    const official = { id: 'account-skin', name: 'Par défaut', favorite: false, order: -1 }
    let entries = [official]
    const library = require('./assets/js/skinlibrary')(ConfigManager.getSkinDirectory(), official)
    const accountSkins = require('./assets/js/accountskin')(library)
    let nextOrder = 0
    let selectedId = null
    let previewId = entries[0].id
    let dialogId = null
    const stageContext = stage.getContext('2d')
    const actions = wardrobe.querySelector('.wardrobe-actions')
    new ResizeObserver(() => {
        actions.style.paddingInlineEnd = `${grid.offsetWidth - grid.clientWidth}px`
    }).observe(grid)

    const frontYaw = 0.33
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
    let turnFrame = 0
    let stageYaw = frontYaw
    let stageFaces = []
    let stageSole = 0
    const orbit = enableSkinOrbit(
        stage,
        (angle) => {
            stageYaw = angle
            drawStage()
        },
        stageYaw,
        () => !turnFrame
    )

    function drawStage() {
        paintPreview(stageContext, stageFaces, stageYaw, stageSole)
    }

    function paintPreview(context, faces, yaw, sole) {
        const { height } = context.canvas
        const scale = 8.7 * (height / 320)
        const baseline = height * 0.9 + sole * cosElevation * scale
        paintSkin(context, faces, yaw, scale, baseline)
    }

    async function decodeSkin(source) {
        if (source instanceof Blob) return createImageBitmap(source)
        const img = new Image()
        img.src = source
        await img.decode()
        return img
    }

    async function getFaces(entry) {
        if (!entry.source) return []
        const atlas = await decodeSkin(entry.source)
        try {
            entry.variant ??= skinVariant(atlas)
            const variant = entry.armVariant ?? entry.variant
            return buildGeometry(convertArmVariant(atlas, entry.variant, variant), variant)
        } finally {
            atlas.close?.()
        }
    }

    let displayedEntry
    let requestedId
    let previewRequest = 0

    function describePreview() {
        const slim = (displayedEntry?.armVariant ?? displayedEntry?.variant) === 'slim'
        armSwitch.setAttribute('aria-checked', String(slim))
        armSwitch.disabled = !displayedEntry?.source || displayedEntry.id !== previewId
        stage.setAttribute(
            'aria-label',
            displayedEntry
                ? `${displayedEntry.name}, skin en 3D, bras ${slim ? 'fins' : 'larges'}. Glissez ou utilisez les touches de direction pour le faire pivoter.`
                : 'Aucun skin à afficher'
        )
        stage.tabIndex = displayedEntry ? 0 : -1
        name.textContent = displayedEntry?.name ?? ''
        homeName.textContent = displayedEntry?.name ?? official.name
    }

    function showSkin(entry, faces) {
        displayedEntry = entry
        stageFaces = faces
        stageSole = entry?.source ? importedSole : 0
        homeFaces = faces
        homeSole = stageSole
        homeName.textContent = entry?.name ?? official.name
        canvas.setAttribute('aria-label', homeName.textContent + ', skin en 3D')
        homeOrbit(frontYaw, true)
        describePreview()
    }

    function turnToSkin(entry, faces) {
        const start = Math.atan2(Math.sin(stageYaw), Math.cos(stageYaw))
        const direction = start < 0 ? -1 : 1
        const back = direction * Math.PI
        const end = frontYaw + direction * 2 * Math.PI
        const started = performance.now()
        orbit(start, true)

        function turn(timestamp) {
            const time = Math.min(Math.max((timestamp - started) / 780, 0), 1)
            const eased = time * time * (3 - 2 * time)
            const angle = start + (end - start) * eased
            if (displayedEntry !== entry && direction * (angle - back) >= 0) showSkin(entry, faces)
            orbit(time < 1 ? angle : frontYaw, true)
            turnFrame = time < 1 ? requestAnimationFrame(turn) : 0
        }

        turnFrame = requestAnimationFrame(turn)
    }

    function refreshPreview(animate, force = false) {
        describePreview()
        const entry = entries.find((item) => item.id === previewId)
        if (!force && requestedId === entry?.id) return
        requestedId = entry?.id
        const request = ++previewRequest
        cancelAnimationFrame(turnFrame)
        turnFrame = 0
        if (!entry || (displayedEntry && !entries.includes(displayedEntry))) {
            showSkin(undefined, [])
            drawStage()
        }
        if (!entry) return
        if (!force && entry === displayedEntry) {
            orbit(frontYaw)
            return
        }
        getFaces(entry)
            .then((faces) => {
                if (request !== previewRequest) return
                if (animate && displayedEntry && !reducedMotion.matches) {
                    turnToSkin(entry, faces)
                } else {
                    showSkin(entry, faces)
                    orbit(force ? stageYaw : frontYaw, true)
                }
            })
            .catch(() => {
                if (request !== previewRequest) return
                requestedId = undefined
                feedback.textContent = `Le skin « ${entry.name} » n’a pas pu être affiché.`
            })
    }

    function saveChange(update) {
        try {
            update()
            return true
        } catch (error) {
            loggerLanding.warn('Sauvegarde du skin impossible', error)
            feedback.textContent = 'Impossible d’enregistrer la modification sur cet ordinateur.'
            return false
        }
    }

    function choose(entry) {
        if (previewId !== entry.id && !saveChange(() => library.select(entry.id))) return
        selectedId = selectedId === entry.id ? null : entry.id
        const changed = previewId !== entry.id
        previewId = entry.id
        refresh(changed)
    }

    const cards = new Map()
    function paintCard(card, entry) {
        const bust = card.querySelector('canvas')
        const variant = entry.armVariant
        getFaces(entry)
            .then((faces) => {
                if (variant !== entry.armVariant) return
                bust.hidden = false
                paintSkin(bust.getContext('2d'), faces, 0.28, 7, 228)
            })
            .catch(() => {
                if (variant === entry.armVariant) bust.hidden = true
            })
    }

    const visibleCards = new IntersectionObserver(
        (records) => {
            for (const { isIntersecting, target } of records) {
                if (!isIntersecting) continue
                visibleCards.unobserve(target)
                const entry = entries.find((item) => item.id === target.dataset.skinId)
                if (entry) paintCard(target, entry)
            }
        },
        { root: grid, rootMargin: '80px' }
    )

    armSwitch.addEventListener('click', () => {
        const entry = displayedEntry
        if (!entry?.source || entry.id !== previewId) return
        const next = (entry.armVariant ?? entry.variant) === 'slim' ? 'classic' : 'slim'
        const armVariant = next === entry.variant ? null : next
        if (entry.id === official.id) {
            const uuid = ConfigManager.getSelectedAccount()?.uuid
            if (!uuid || uuid !== previewAccount || !saveChange(() => library.setAccountArmVariant(uuid, armVariant))) return
        } else if (!saveChange(() => library.update(entry.id, { armVariant }))) return
        entry.armVariant = armVariant
        const card = cards.get(entry.id)?.card
        if (card) paintCard(card, entry)
        refreshPreview(false, true)
    })

    function makeCard(entry) {
        const card = document.createElement('div')
        card.className = 'wardrobe-card'
        card.dataset.skinId = entry.id
        const select = document.createElement('button')
        select.type = 'button'
        select.className = 'wardrobe-select'
        const bust = document.createElement('canvas')
        bust.width = 160
        bust.height = 144
        bust.setAttribute('aria-hidden', 'true')
        const label = document.createElement('span')
        select.append(bust, label)
        select.addEventListener('click', () => choose(entry))
        const star = document.createElement('button')
        star.type = 'button'
        star.className = 'wardrobe-star'
        star.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/></svg>'
        star.addEventListener('click', (event) => {
            if (!saveChange(() => library.update(entry.id, { favorite: !entry.favorite }))) return
            entry.favorite = !entry.favorite
            refresh()
            if (event.detail === 0) star.focus({ preventScroll: true })
            if (entry.favorite) grid.scrollTop = 0
        })
        card.append(select)
        if (entry.id !== official.id) card.append(star)
        visibleCards.observe(card)
        return { card, select, label, star }
    }

    const addCard = document.createElement('button')
    addCard.type = 'button'
    addCard.className = 'wardrobe-select wardrobe-add'
    addCard.setAttribute('aria-label', 'Ajouter un skin')
    addCard.setAttribute('aria-haspopup', 'dialog')
    addCard.title = 'Ajouter un skin'
    addCard.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>'

    function refresh(animate = false) {
        const sorted = [...entries].sort((first, second) => Number(second.id === official.id) - Number(first.id === official.id) || Number(second.favorite) - Number(first.favorite))
        const orderedCards = sorted.map((entry) => {
            if (!cards.has(entry.id)) cards.set(entry.id, makeCard(entry))
            const { card, select, label, star } = cards.get(entry.id)
            select.setAttribute('aria-pressed', String(entry.id === selectedId))
            label.textContent = label.title = entry.name
            star.setAttribute('aria-label', `Favori · ${entry.name}`)
            star.title = entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'
            star.setAttribute('aria-pressed', String(entry.favorite))
            return card
        })
        orderedCards.push(addCard)
        if (
            grid.children.length !== orderedCards.length ||
            orderedCards.some((card, index) => grid.children[index] !== card)
        ) {
            const scroll = grid.scrollTop
            const fragment = document.createDocumentFragment()
            for (const card of orderedCards) fragment.append(card)
            grid.replaceChildren(fragment)
            grid.scrollTop = scroll
        }
        actions.hidden = renameButton.hidden = deleteButton.hidden = !selectedId || selectedId === official.id
        refreshPreview(animate)
    }

    function setOpen(open) {
        toggle.setAttribute('aria-expanded', String(open))
        wardrobe.hidden = !open
        wardrobe.inert = !open
        if (open) {
            refresh()
            refreshAccountSkin()
        }
    }

    async function readSkin(file) {
        if (!file || file.size > 16 * 1024 * 1024) throw new Error('Taille du fichier')
        const header = new DataView(await file.slice(0, 24).arrayBuffer())
        if (
            header.byteLength !== 24 ||
            header.getUint32(0) !== 0x89504e47 ||
            header.getUint32(4) !== 0x0d0a1a0a ||
            header.getUint32(8) !== 13 ||
            header.getUint32(12) !== 0x49484452 ||
            !skinDimensions(header.getUint32(16), header.getUint32(20))
        )
            throw new Error('Dimensions du fichier')
        const bitmap = await createImageBitmap(file)
        try {
            if (!skinDimensions(bitmap.width, bitmap.height)) throw new Error('Dimensions du fichier')
            return skinVariant(bitmap)
        } finally {
            bitmap.close()
        }
    }

    toggle.addEventListener('click', () => {
        if (getCurrentView() === VIEWS.settings) {
            if (settingsNavDone.disabled) return
            settingsNavDone.click()
            setOpen(true)
        } else setOpen(wardrobe.hidden)
    })
    document.querySelector('.wardrobe-done').addEventListener('click', () => {
        setOpen(false)
        toggle.focus()
    })
    document.querySelector('.brand').addEventListener('click', (event) => {
        event.preventDefault()
        if (getCurrentView() === VIEWS.settings) {
            if (settingsNavDone.disabled) return
            settingsNavDone.click()
        }
        setOpen(false)
    })
    let suggestedName = ''
    addCard.addEventListener('click', () => {
        addForm.reset()
        suggestedName = ''
        addError.textContent = ''
        addName.removeAttribute('aria-invalid')
        addDialog.showModal()
    })
    fileInput.addEventListener('change', () => {
        const previousSuggestion = suggestedName
        suggestedName = (fileInput.files[0]?.name ?? '')
            .replace(/\.png$/i, '')
            .trim()
            .slice(0, 48)
        if (!addName.value.trim() || addName.value === previousSuggestion) addName.value = suggestedName
        addError.textContent = ''
        addName.removeAttribute('aria-invalid')
    })
    addCancel.addEventListener('click', () => addDialog.close())
    addName.addEventListener('input', () => {
        addError.textContent = ''
        addName.removeAttribute('aria-invalid')
    })
    addDialog.addEventListener('cancel', (event) => {
        if (addSubmit.disabled) event.preventDefault()
    })
    addForm.addEventListener('submit', async (event) => {
        event.preventDefault()
        if (addSubmit.disabled) return
        const name = addName.value.trim()
        if (!name) {
            addName.value = ''
            addName.reportValidity()
            return
        }
        const file = fileInput.files[0]
        const fields = [addSubmit, addCancel, fileInput, addName]
        for (const field of fields) field.disabled = true
        addError.textContent = ''
        try {
            let variant
            try {
                variant = await readSkin(file)
            } catch {
                addError.textContent = 'Choisis un PNG Minecraft de 64 × 32, 64 × 64, 128 × 64 ou 128 × 128 px (16 Mo maximum).'
                return
            }
            const entry = { id: crypto.randomUUID(), name, favorite: false, order: nextOrder, variant }
            entry.source = library.add(entry, Buffer.from(await file.arrayBuffer()))
            nextOrder++
            entries.push(entry)
            selectedId = null
            previewId = entry.id
            addDialog.close()
            refresh(true)
            addCard.focus({ preventScroll: true })
            grid.scrollTop = grid.scrollHeight
        } catch (error) {
            if (error.code === 'DUPLICATE_SKIN_NAME') {
                addName.disabled = false
                addName.setAttribute('aria-invalid', 'true')
                addName.focus()
                addError.textContent = error.message
            } else {
                addError.textContent = 'Le skin n’a pas pu être enregistré dans le stockage local.'
            }
        } finally {
            for (const field of fields) field.disabled = false
        }
    })

    const renameError = renameDialog.querySelector('.wardrobe-add-error')
    renameInput.addEventListener('input', () => {
        renameError.textContent = ''
        renameInput.removeAttribute('aria-invalid')
    })
    renameButton.addEventListener('click', () => {
        const entry = entries.find((item) => item.id === selectedId)
        dialogId = entry.id
        renameDialog.returnValue = ''
        renameInput.value = entry.name
        renameError.textContent = ''
        renameInput.removeAttribute('aria-invalid')
        renameDialog.showModal()
        renameInput.select()
    })
    renameDialog.querySelector('form').addEventListener('submit', (event) => {
        if (event.submitter?.value === 'cancel') return
        event.preventDefault()
        const name = renameInput.value.trim()
        if (!name) {
            renameInput.value = ''
            renameInput.reportValidity()
            return
        }
        const entry = entries.find((item) => item.id === dialogId)
        try {
            library.update(entry.id, { name })
        } catch (error) {
            if (error.code === 'DUPLICATE_SKIN_NAME') renameInput.setAttribute('aria-invalid', 'true')
            renameError.textContent = error.code === 'DUPLICATE_SKIN_NAME' ? error.message : 'Impossible d’enregistrer le nouveau nom.'
            renameInput.focus()
            return
        }
        entry.name = name
        refresh()
        renameDialog.close('confirm')
    })
    deleteButton.addEventListener('click', () => {
        const entry = entries.find((item) => item.id === selectedId)
        dialogId = entry.id
        deleteDialog.returnValue = ''
        deleteDialog.querySelector('p').textContent = `Supprimer « ${entry.name} » de la garde-robe ?`
        deleteDialog.showModal()
    })
    deleteDialog.addEventListener('close', () => {
        if (deleteDialog.returnValue !== 'confirm') return
        const removedId = dialogId
        if (!saveChange(() => library.remove(removedId))) return
        entries = entries.filter((entry) => entry.id !== removedId)
        visibleCards.unobserve(cards.get(removedId).card)
        cards.delete(removedId)
        selectedId = null
        previewId = official.id
        refresh()

        addCard.focus({ preventScroll: true })
    })

    try {
        const saved = library.load()
        entries = saved.entries
        nextOrder = (entries.at(-1)?.order ?? -1) + 1
        previewId = saved.active ?? entries[0]?.id
        refreshPreview(false)
    } catch (error) {
        loggerLanding.warn('Lecture de la garde-robe impossible', error)
        feedback.textContent = 'Impossible de charger la collection de skins de cet ordinateur.'
        addCard.disabled = true
    }
    let profileRequest = 0
    let previewAccount
    let previewTexture
    const accountStatus = wardrobe.querySelector('.wardrobe-account-status')

    async function readDefaultTexture(uuid) {
        const fs = require('node:fs')
        const path = require('node:path')
        const { rawServer } = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const version = rawServer.minecraftVersion
        const jar = path.join(ConfigManager.getCommonDirectory(), 'versions', version, version + '.jar')
        if (!fs.existsSync(jar)) return {}
        const rawUuid = uuid.replace(/-/g, '')
        const slim = [7, 15, 23, 31].reduce((parity, index) => parity ^ parseInt(rawUuid[index], 16), 0) & 1
        const file = slim ? 'alex.png' : 'steve.png'
        const archive = new (require('adm-zip'))(jar)
        const bytes = archive.readFile('assets/minecraft/textures/entity/' + file)
        return bytes ? { source: new Blob([bytes], { type: 'image/png' }), variant: slim ? 'slim' : 'classic' } : {}
    }

    function setAccountTexture(source, variant) {
        const card = cards.get(official.id)
        if (card) visibleCards.unobserve(card.card)
        cards.delete(official.id)
        const armVariant = source && previewAccount ? library.getAccountArmVariant(previewAccount) : undefined
        entries[0] = { ...official, source, variant, armVariant }
        if (previewId === official.id) requestedId = undefined
        refresh()
    }

    async function refreshAccountSkin() {
        const request = ++profileRequest
        const account = ConfigManager.getSelectedAccount()
        if (previewAccount !== account?.uuid) {
            previewAccount = account?.uuid
            previewTexture = undefined
            setAccountTexture()
        }
        if (account?.type !== 'microsoft') {
            accountStatus.textContent = 'Connecte un compte Microsoft pour afficher et appliquer ton skin Minecraft.'
            return
        }
        try {
            const original = await accountSkins.synchronize(account)
            const key = original ? original.url + ':' + original.variant : null
            if (request !== profileRequest) return
            if (previewTexture !== key) {
                const texture = original
                    ? { source: new Blob([await accountSkins.readTexture(original)], { type: 'image/png' }), variant: original.variant }
                    : await readDefaultTexture(account.uuid)
                if (request !== profileRequest) return
                previewTexture = texture.source ? key : undefined
                setAccountTexture(texture.source, texture.variant)
            }
            accountStatus.textContent = original ? '' : 'Ce compte utilise le skin Minecraft par défaut.'
        } catch {
            if (request === profileRequest) accountStatus.textContent = 'Impossible de récupérer le skin du compte Minecraft.'
        }
    }

    async function applyWardrobeSkin(account, server) {
        const selected = entries.find(entry => entry.id === previewId)
        const accountDefault = !selected || selected.id === official.id
        const accountVariant = accountDefault ? library.getAccountArmVariant(account.uuid) : undefined
        if (accountDefault && !accountVariant && !library.getAccountSkin(account.uuid)?.applied) return { account }
        if (account.type !== 'microsoft') throw new Error('Un compte Microsoft est nécessaire pour appliquer un skin.')
        if (!(await AuthManager.validateSelected()) || ConfigManager.getSelectedAccount()?.uuid !== account.uuid) {
            throw new Error('Reconnecte ton compte Microsoft pour appliquer le skin.')
        }
        const authenticated = ConfigManager.getSelectedAccount()
        if (accountDefault) {
            await accountSkins.synchronize(authenticated, accountVariant ? {
                variant: accountVariant,
                defaultTexture: async () => {
                    const { source } = await readDefaultTexture(account.uuid)
                    if (!source) throw new Error('Le skin Minecraft par défaut est introuvable.')
                    return Buffer.from(await source.arrayBuffer())
                },
                prepareTexture: (bytes, sourceVariant) => prepareSkinTexture(bytes, sourceVariant, accountVariant)
            } : {})
        } else {
            let variant = selected.variant
            if (!variant) {
                const atlas = await decodeSkin(selected.source)
                try {
                    variant = skinVariant(atlas)
                } finally {
                    atlas.close?.()
                }
            }
            const target = selected.armVariant ?? variant
            if (supportsHdSkins(server)) {
                const bytes = library.readSkin(selected.id)
                if (canRelayHdSkin(bytes)) {
                    return {
                        account: authenticated,
                        hdSkin: { bytes: await prepareSkinTexture(bytes, variant, target, true), variant: target }
                    }
                }
            }
            await accountSkins.synchronize(authenticated, {
                id: selected.id,
                variant: target,
                prepareTexture: bytes => prepareSkinTexture(bytes, variant, target)
            })
        }
        return { account: authenticated }
    }

    async function prepareSkinTexture(bytes, sourceVariant, targetVariant, hd = false) {
        const atlas = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        try {
            const source = sourceVariant ?? skinVariant(atlas)
            const converted = hd ? convertArmVariant(atlas, source, targetVariant, true) : accountSkinTexture(atlas, source, targetVariant)
            if (converted === atlas) return bytes
            const blob = await new Promise(resolve => converted.toBlob(resolve, 'image/png'))
            if (!blob) throw new Error('Impossible de préparer le skin Minecraft.')
            return Buffer.from(await blob.arrayBuffer())
        } finally {
            atlas.close()
        }
    }

    document.addEventListener('minecraft-account-change', refreshAccountSkin)
    refreshAccountSkin()
    return { closeWardrobe: () => setOpen(false), applyWardrobeSkin }
})()
