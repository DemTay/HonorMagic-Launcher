const blocks = [
    { kind: 'head', x: -4, y: 23, z: -4, w: 8, h: 8, d: 8 },
    { kind: 'body', x: -4, y: 11, z: -2, w: 8, h: 12, d: 4 },
    { kind: 'arm', x: -8, y: 11, z: -2, w: 4, h: 12, d: 4 },
    { kind: 'arm', x: 4, y: 11, z: -2, w: 4, h: 12, d: 4 },
    { kind: 'leg', x: -4.18, y: 0, z: -2, w: 4, h: 11, d: 4 },
    { kind: 'leg', x: 0.18, y: 0, z: -2, w: 4, h: 11, d: 4 }
]
const surfaces = [
    {
        side: 'front',
        normal: [0, 0, 1],
        points: [
            [0, 1, 1],
            [1, 1, 1],
            [0, 0, 1]
        ],
        axes: ['w', 'h'],
        light: 0
    },
    {
        side: 'back',
        normal: [0, 0, -1],
        points: [
            [1, 1, 0],
            [0, 1, 0],
            [1, 0, 0]
        ],
        axes: ['w', 'h'],
        light: 0.22
    },
    {
        side: 'right',
        normal: [1, 0, 0],
        points: [
            [1, 1, 1],
            [1, 1, 0],
            [1, 0, 1]
        ],
        axes: ['d', 'h'],
        light: 0.18
    },
    {
        side: 'left',
        normal: [-1, 0, 0],
        points: [
            [0, 1, 0],
            [0, 1, 1],
            [0, 0, 0]
        ],
        axes: ['d', 'h'],
        light: 0.27
    },
    {
        side: 'top',
        normal: [0, 1, 0],
        points: [
            [0, 1, 0],
            [1, 1, 0],
            [0, 1, 1]
        ],
        axes: ['w', 'd'],
        light: -0.12
    },
    {
        side: 'bottom',
        normal: [0, -1, 0],
        points: [
            [0, 0, 1],
            [1, 0, 1],
            [0, 0, 0]
        ],
        axes: ['w', 'd'],
        light: 0.3
    }
]
function mesh(block, layer, extract) {
    return surfaces.map((surface) => {
        const extra = layer === 'outer' ? (block.kind === 'head' ? 0.23 : 0.15) : 0
        const bitmap = extract(surface)
        const ink = bitmap.getContext('2d')
        const { light } = surface
        ink.globalCompositeOperation = 'source-atop'
        ink.fillStyle = light > 0 ? `rgba(20,11,24,${light})` : `rgba(255,237,197,${-light})`
        ink.fillRect(0, 0, bitmap.width, bitmap.height)
        const points = surface.points.map(([x, y, z]) => [
            block.x + x * block.w + (2 * x - 1) * extra,
            block.y + y * block.h + (2 * y - 1) * extra,
            block.z + z * block.d + (2 * z - 1) * extra
        ])
        return { ...surface, points, bitmap }
    })
}
const elevation = 0.115
const cosElevation = Math.cos(elevation)
const sinElevation = Math.sin(elevation)
function paintSkin(context, model, yaw, scale, baseline) {
    const { width, height } = context.canvas
    context.clearRect(0, 0, width, height)
    const cosYaw = Math.cos(yaw),
        sinYaw = Math.sin(yaw)
    function rotate([x, y, z]) {
        const depth = z * cosYaw - x * sinYaw
        return [
            x * cosYaw + z * sinYaw,
            -y * cosElevation + depth * sinElevation,
            y * sinElevation + depth * cosElevation
        ]
    }
    function project(point) {
        const [x, y, z] = rotate(point)
        return [width / 2 + x * scale, baseline + y * scale, z]
    }
    const faces = model
        .filter((face) => rotate(face.normal)[2] > 0.001)
        .map((face) => {
            const [a, b, c] = face.points.map(project)
            const depth = (b[2] + c[2]) / 2
            return { ...face, a, b, c, depth }
        })
        .sort((a, b) => a.depth - b.depth)
    for (const face of faces) {
        const { bitmap, a, b, c } = face
        context.save()
        context.imageSmoothingEnabled = false
        context.transform(
            (b[0] - a[0]) / bitmap.width,
            (b[1] - a[1]) / bitmap.width,
            (c[0] - a[0]) / bitmap.height,
            (c[1] - a[1]) / bitmap.height,
            a[0],
            a[1]
        )
        context.drawImage(bitmap, 0, 0)
        context.restore()
    }
}
function enableSkinOrbit(canvas, paint, initialYaw, canInteract = () => true) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let yaw = initialYaw
    let target = yaw
    let drag = null
    let frame = 0
    let lastTime = 0
    function animate(time) {
        const elapsed = lastTime ? time - lastTime : 16
        lastTime = time
        yaw += (target - yaw) * (1 - Math.exp(-elapsed / 58))
        if (Math.abs(target - yaw) > 0.001) {
            paint(yaw)
            frame = requestAnimationFrame(animate)
        } else {
            yaw = target
            paint(yaw)
            frame = 0
            lastTime = 0
        }
    }
    function aim(next, immediate = false) {
        target = next
        if (immediate || reduced.matches) {
            cancelAnimationFrame(frame)
            frame = 0
            lastTime = 0
            yaw = target
            paint(yaw)
        } else if (!frame) {
            frame = requestAnimationFrame(animate)
        }
    }
    canvas.addEventListener('pointerdown', (event) => {
        if (!canInteract() || !event.isPrimary || event.button !== 0) return
        drag = {
            id: event.pointerId,
            x: event.clientX,
            yaw: target,
            scale: 11 / canvas.getBoundingClientRect().width
        }
        canvas.setPointerCapture(event.pointerId)
        canvas.classList.add('dragging')
    })
    canvas.addEventListener('pointermove', (event) => {
        if (canInteract() && drag?.id === event.pointerId)
            aim(drag.yaw + (event.clientX - drag.x) * drag.scale)
    })
    canvas.addEventListener('lostpointercapture', () => {
        drag = null
        canvas.classList.remove('dragging')
    })
    canvas.addEventListener('keydown', (event) => {
        if (canInteract() && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault()
            aim(target + (event.key === 'ArrowLeft' ? -0.38 : 0.38))
        }
    })
    function resizeCanvas() {
        const bounds = canvas.getBoundingClientRect()
        const width = Math.round(bounds.width * window.devicePixelRatio)
        const height = Math.round(bounds.height * window.devicePixelRatio)
        if (!width || !height || (canvas.width === width && canvas.height === height)) return
        canvas.width = width
        canvas.height = height
        paint(yaw)
    }
    function watchPixelRatio() {
        const resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        resolution.addEventListener('change', () => {
            resizeCanvas()
            watchPixelRatio()
        }, { once: true })
    }
    new ResizeObserver(resizeCanvas).observe(canvas)
    watchPixelRatio()
    paint(yaw)
    return aim
}
function textureCoordinates(index, layer, legacy) {
    const base = [
        [0, 0],
        [16, 16],
        [40, 16],
        [32, 48],
        [0, 16],
        [16, 48]
    ]
    const outer = [
        [32, 0],
        [16, 32],
        [40, 32],
        [48, 48],
        [0, 32],
        [0, 48]
    ]
    const mirror = legacy && (index === 3 || index === 5)
    const layerCoordinates = layer === 'outer' ? outer : base
    return { origin: layerCoordinates[mirror ? index - 1 : index], mirror }
}

function atlasRegion(block, index, layer, surface, legacy) {
    const {
        origin: [u, v],
        mirror
    } = textureCoordinates(index, layer, legacy)
    const { w, d } = block
    const regions = {
        top: [u + d, v],
        bottom: [u + d + w, v],
        left: [u, v + d],
        front: [u + d, v + d],
        right: [u + d + w, v + d],
        back: [u + 2 * d + w, v + d]
    }
    const opposite = { left: 'right', right: 'left' }
    const [x, y] = regions[(mirror && opposite[surface.side]) || surface.side]
    const [width, height] = surface.axes.map((axis) => block[axis])
    return { x, y, width, height, mirror }
}

function atlasFace(atlas, block, index, layer, surface, legacy) {
    const { x, y, width, height, mirror } = atlasRegion(block, index, layer, surface, legacy)
    const face = document.createElement('canvas')
    face.width = width
    face.height = height
    const ink = face.getContext('2d')
    if (mirror) {
        ink.translate(width, 0)
        ink.scale(-1, 1)
    }
    ink.drawImage(atlas, x, y, width, height, 0, 0, width, height)
    ink.resetTransform()
    return face
}

const importedSole = -1

function skinVariant(atlas) {
    if (atlas.height === 32) return 'classic'
    const pixels = document.createElement('canvas')
    pixels.width = atlas.width
    pixels.height = atlas.height
    const ink = pixels.getContext('2d')
    ink.drawImage(atlas, 0, 0)
    const transparentArms = [[54, 20], [46, 52]].every(([x, y]) =>
        ink.getImageData(x, y, 2, 12).data.every((value, index) => index % 4 !== 3 || value === 0)
    )
    return transparentArms ? 'slim' : 'classic'
}

function convertArmVariant(atlas, sourceVariant, targetVariant) {
    if (sourceVariant === targetVariant) return atlas
    const legacy = atlas.height === 32
    const converted = document.createElement('canvas')
    converted.width = converted.height = 64
    const ink = converted.getContext('2d')
    ink.imageSmoothingEnabled = false
    ink.drawImage(atlas, 0, 0)
    for (const [index, block] of blocks.entries()) {
        if (block.kind !== 'arm' && !(legacy && index === 5)) continue
        const part = { ...block, h: 12 }
        const source = { ...part, w: part.kind === 'arm' && sourceVariant === 'slim' ? 3 : part.w }
        const target = { ...part, w: part.kind === 'arm' && targetVariant === 'slim' ? 3 : part.w }
        for (const layer of legacy ? ['base'] : ['base', 'outer']) {
            const { origin: [x, y] } = textureCoordinates(index, layer, false)
            ink.clearRect(x, y, 2 * (part.w + part.d), part.h + part.d)
            for (const surface of surfaces) {
                const face = atlasFace(atlas, source, index, layer, surface, legacy)
                const region = atlasRegion(target, index, layer, surface, false)
                ink.drawImage(face, region.x, region.y, region.width, region.height)
            }
        }
    }
    return converted
}

function buildGeometry(atlas, variant = skinVariant(atlas)) {
    const legacy = atlas.height === 32
    return blocks.flatMap((block, index) => {
        const part = { ...block, h: block.kind === 'leg' ? 12 : block.h }
        if (part.kind === 'leg') part.y = importedSole
        if (variant === 'slim' && part.kind === 'arm') {
            part.w = 3
            if (part.x < 0) part.x = -7
        }
        const layers = legacy && index !== 0 ? ['base'] : ['base', 'outer']
        return layers.flatMap(layer => mesh(part, layer, surface => atlasFace(atlas, part, index, layer, surface, legacy)))
    })
}

module.exports = { cosElevation, importedSole, paintSkin, enableSkinOrbit, buildGeometry, skinVariant, convertArmVariant }
