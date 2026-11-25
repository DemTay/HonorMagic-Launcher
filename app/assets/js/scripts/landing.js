/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    getServerStatus
}                             = require('helios-core/mojang')
const {
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')

// Launch Elements
const launchButton            = document.getElementById('launch_button')
const launchButtonLabel       = launchButton.querySelector('b')
const launchPlayIcon          = document.getElementById('launch_play_icon')
const launchUpdateIcon        = document.getElementById('launch_update_icon')
const launcherUpdateBell      = document.getElementById('launcher_update_bell')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const serverStatusIndicator   = document.getElementById('hm-server')
const serverStatusLabel       = serverStatusIndicator.querySelector('span')
const playerCount             = document.getElementById('player_count')
let launchEnabled = false
let launchInProgress = false
let gameStarted = false
let launchProgressFrame
let launchProgressTimeout
let launchProgressTime
let launchProgressTarget = 0
let launchProgressLimit = 15
let proc

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    const wasLaunching = launchInProgress
    launchInProgress = loading
    if (loading && !wasLaunching) {
        launch_progress.value = 0
        launchProgressTarget = 0
        launchProgressLimit = 15
        launchProgressTime = performance.now()
        launchProgressFrame = requestAnimationFrame(animateLaunchProgress)
    } else if (!loading) {
        cancelAnimationFrame(launchProgressFrame)
        clearTimeout(launchProgressTimeout)
        launch_details.textContent = ''
        remote.getCurrentWindow().setProgressBar(-1)
    }
    updateLaunchButton()
}

function isGameBusy(){
    return launchInProgress || gameStarted || Boolean(proc)
}

function updateLaunchButton(){
    const gameBusy = isGameBusy()
    const updateStatus = gameBusy ? 'idle' : launcherUpdate.status
    const updateActionable = updateStatus === 'available' || updateStatus === 'ready'
    const downloadingUpdate = updateStatus === 'downloading'
    const showUpdateIcon = updateActionable || downloadingUpdate

    launcherUpdateBell.hidden = !updateActionable
    launchPlayIcon.style.display = showUpdateIcon ? 'none' : ''
    launchUpdateIcon.style.display = showUpdateIcon ? '' : 'none'
    if (showUpdateIcon) {
        launchButtonLabel.textContent = Lang.queryJS(`landing.update.${updateStatus}`)
    } else {
        launchButtonLabel.textContent = gameStarted ? 'Jeu lancé' : gameBusy ? 'Lancement…' : 'Jouer'
    }
    launchButton.disabled = gameBusy || downloadingUpdate || (!updateActionable && !launchEnabled)
    launch_progress.hidden = !launchInProgress && !downloadingUpdate
    launch_progress.setAttribute('aria-label', Lang.queryJS(downloadingUpdate ? 'landing.update.progress' : 'landing.launch.progress'))
    refreshSettingsUpdateAction()
}

function setLauncherDownloadProgress(percent){
    const value = Math.min(100, Math.max(0, percent))
    launch_progress.value = value
    remote.getCurrentWindow().setProgressBar(value / 100)
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details.textContent = details
}

/**
 * Report measured progress and reserve room to advance until the next stage.
 *
 * @param {number} percent Percentage (0-100)
 * @param {number} limit Upper bound for visual progress while waiting for updates
 */
function setLaunchPercentage(percent, limit = launchProgressLimit){
    if (!launchInProgress) return
    launchProgressTarget = Math.max(launchProgressTarget, percent)
    launchProgressLimit = limit
}

function animateLaunchProgress(time){
    const current = launch_progress.value
    const catchingUp = current < launchProgressTarget - 0.02
    const goal = catchingUp ? launchProgressTarget : launchProgressLimit
    const duration = catchingUp ? 140 : 12000
    const elapsed = Math.max(0, time - launchProgressTime)
    const next = current + Math.max(0, goal - current) * (1 - Math.exp(-elapsed / duration))
    launch_progress.value = launchProgressTarget === 100 && next >= 99.98 ? 100 : next
    launchProgressTime = time
    if (launch_progress.value === 100) {
        launchProgressTimeout = setTimeout(() => toggleLaunchArea(false), 500)
    } else {
        launchProgressFrame = requestAnimationFrame(animateLaunchProgress)
    }
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent, start, end){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(start + (end-start)*percent/100)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    launchEnabled = val
    updateLaunchButton()
}

// Bind launch button
launchButton.addEventListener('click', async () => {
    if (launchButton.disabled || isGameBusy() || launcherUpdate.status === 'downloading') return
    if (launcherUpdate.status === 'available' || launcherUpdate.status === 'ready') {
        requestLauncherUpdate()
        return
    }
    setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(1)
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    if (getCurrentView() === VIEWS.settings) {
        if (!settingsNavDone.disabled) settingsNavDone.click()
        return
    }
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
    }
    document.getElementById('settingsMediaButton').title = 'Paramètres · ' + username
    document.dispatchEvent(new Event('minecraft-account-change'))
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}

let serverStatusCheck = 0

async function refreshServerStatus(){
    const check = ++serverStatusCheck
    const serverId = ConfigManager.getSelectedServer()
    let status
    let timeout
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(serverId)
        if (server) {
            // Bound the check even if the server closes the connection without a reply.
            status = await Promise.race([
                getServerStatus(47, server.hostname, server.port),
                new Promise(resolve => { timeout = setTimeout(resolve, 8000) })
            ])
        }
    } catch (error) {
        loggerLanding.debug(error)
    } finally {
        clearTimeout(timeout)
    }
    if (check !== serverStatusCheck || ConfigManager.getSelectedServer() !== serverId) return

    const online = status != null
    const players = status?.players?.online
    serverStatusIndicator.dataset.online = String(online)
    serverStatusLabel.textContent = online ? 'Serveur en ligne' : 'Serveur hors ligne'
    playerCount.textContent = Number.isInteger(players) ? `${players} ${players === 1 ? 'joueur connecté' : 'joueurs connectés'}` : ''
}

setInterval(refreshServerStatus, 30000)


/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(2)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(async () => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                await downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100),2,14)
    })
    setDownloadPercentage(100,2,14)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
// Is DiscordRPC enabled
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), 'Connectez-vous pour lancer le jeu.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(15, 50)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(15 + percent * .35)
        })
        setLaunchPercentage(50)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(50, 95)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent,50,94)
            })
            setDownloadPercentage(100,50,94)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))
    setLaunchPercentage(95, 98)

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const account = ConfigManager.getSelectedAccount()
        if (!account) {
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), 'Connecte un compte pour lancer le jeu.')
            return
        }
        let authUser
        let hdSkin
        try {
            const wardrobeSkin = await applyWardrobeSkin(account, serv)
            authUser = wardrobeSkin.account
            hdSkin = wardrobeSkin.hdSkin
        } catch (error) {
            loggerLaunchSuite.warn('Impossible de synchroniser le skin', error.code || error.name)
            showLaunchFailure('Impossible d’appliquer le skin', 'Vérifie la connexion à ton compte Microsoft, puis réessaie ou sélectionne « Par défaut ».')
            return
        }
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        let hasRPC = false
        let pendingOutput = ''

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            const lines = (pendingOutput + data).split('\n')
            pendingOutput = lines.pop()
            if (!lines.some(line => GAME_LAUNCH_REGEX.test(line.trim())) && !GAME_LAUNCH_REGEX.test(pendingOutput.trim())) return
            gameStarted = true
            setLaunchPercentage(100, 100)
            updateLaunchButton()
            setLaunchDetails('Jeu lancé')
            if (hasRPC) {
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            await pb.prepareMultiplayer()
            pb.prepareResourcePack()
            // Build Minecraft process.
            proc = pb.build(hdSkin)
            setLaunchPercentage(98, 99)
            proc.once('close', () => {
                proc = null
                gameStarted = false
                toggleLaunchArea(false)
                if (hasRPC) {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                }
            })
            proc.once('error', error => {
                loggerLaunchSuite.error('Error during launch', error)
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))
            })

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false


function showNews(open) {
    newsActive = open
    const container = document.getElementById('newsContainer')
    container.inert = !open
    container.classList.toggle('open',open)
    document.querySelector('.hm-app').inert = open
    if (open) {
        $('#newsContainer *').removeAttr('tabindex')
        document.getElementById('hm-news-close').focus()
        if (newsAlertShown) {
            $('#newsButtonAlert').fadeOut(200)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    } else {
        document.getElementById('newsButton').focus()
    }
}
document.getElementById('newsButton').onclick = () => showNews(!newsActive)
document.getElementById('hm-news-close').onclick = () => showNews(false)

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.date)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing && !document.getElementById('newsButton').hidden && document.querySelector('.wardrobe').hidden && !document.querySelector('dialog[open]')){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = 'by ' + articleObject.author
    newsArticleDate.innerHTML = articleObject.date
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){

    const distroData = await DistroAPI.getDistribution()
    document.getElementById('newsButton').hidden = !distroData.rawDistribution.rss
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }

    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    const date = new Date(el.find('pubDate').text()).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric'})

                    // Resolve comments.
                    let comments = el.find('slash\\:comments').text() || '0'
                    comments = comments + ' Comment' + (comments === '1' ? '' : 's')

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments'
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}
