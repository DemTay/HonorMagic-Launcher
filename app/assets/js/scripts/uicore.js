/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
let launcherUpdate = { status: 'idle', info: null }
if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        switch(arg){
            case 'update-available':
                loggerAutoUpdater.info('New update available', info.version)
                setLauncherUpdate('available', info)
                break
            case 'download-progress':
                if (launcherUpdate.status === 'downloading' && Number.isFinite(info)) {
                    setLauncherDownloadProgress(info)
                }
                break
            case 'update-downloaded':
                loggerAutoUpdater.info('Update ' + info.version + ' ready to be installed.')
                setLauncherUpdate('ready', { ...launcherUpdate.info, ...info })
                break
            case 'update-download-error':
                loggerAutoUpdater.error('Unable to download the update.', info)
                setLauncherUpdate('available', launcherUpdate.info, 'updateErrorTitle')
                break
            case 'update-not-available':
                loggerAutoUpdater.info('No new update found.')
                setLauncherUpdate('idle', null, 'latestVersionTitle')
                break
            case 'ready':
                clearInterval(updateCheckListener)
                updateCheckListener = setInterval(checkForLauncherUpdate, 1800000)
                checkForLauncherUpdate()
                break
            case 'realerror':
                loggerAutoUpdater.error('Unable to check for an update.', info)
                setLauncherUpdate('idle', null, 'updateErrorTitle')
                break
            default:
                loggerAutoUpdater.info('Unknown argument', arg)
                break
        }
    })
}

function setLauncherUpdate(status, info = null, settingsStatus){
    if (launcherUpdate.status === 'downloading' && status !== 'downloading') {
        remote.getCurrentWindow().setProgressBar(-1)
        setLaunchDetails(status === 'ready' ? Lang.queryJS('landing.update.ready') : Lang.queryJS('settings.updates.updateErrorTitle'))
    }
    launcherUpdate = { status, info }
    populateSettingsUpdateInformation(info, settingsStatus)
    updateLaunchButton()
}

function checkForLauncherUpdate(){
    if (isDev || !['idle', 'available'].includes(launcherUpdate.status)) return
    setLauncherUpdate('checking')
    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
}

function requestLauncherUpdate(){
    if (isDev || isGameBusy()) return
    if (launcherUpdate.status === 'ready') {
        ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
    } else if (launcherUpdate.status === 'available') {
        const info = launcherUpdate.info
        if (info.downloadPage) {
            shell.openExternal(info.downloadPage).catch(error => {
                loggerAutoUpdater.error('Unable to open the releases page.', error)
            })
            return
        }
        setLauncherUpdate('downloading', info)
        setLaunchDetails(Lang.queryJS('landing.update.downloading'))
        setLauncherDownloadProgress(0)
        ipcRenderer.send('autoUpdateAction', 'downloadUpdate')
    }
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code. 
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})
