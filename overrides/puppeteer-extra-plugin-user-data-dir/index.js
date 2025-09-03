'use strict'

const util = require('util')
const fs = require('fs')
const fse = require('fs-extra')
const os = require('os')
const path = require('path')
const debug = require('debug')('puppeteer-extra-plugin:user-data-dir')
const mkdtempAsync = util.promisify(fs.mkdtemp)
const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')

/**
 * Custom user data directory management for Puppeteer.
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor (opts = {}) {
    super(opts)

    this._userDataDir = null
    this._isTemporary = false

    const defaults = {
      deleteTemporary: true,
      deleteExisting: false,
      files: []
    }
    // Follow Puppeteer's temporary user data dir naming convention by default
    defaults.folderPath = os.tmpdir()
    defaults.folderPrefix = 'puppeteer_dev_profile-'

    this._opts = Object.assign(defaults, opts)
    debug('initialized', this._opts)
  }

  get name () {
    return 'user-data-dir'
  }

  get requirements () {
    return new Set(['runLast', 'dataFromPlugins'])
  }

  get shouldDeleteDirectory () {
    if (this._isTemporary && this._opts.deleteTemporary) {
      return true
    }
    return this._opts.deleteExisting
  }

  get temporaryDirectoryPath () {
    return path.join(this._opts.folderPath, this._opts.folderPrefix)
  }

  get defaultProfilePath () {
    return path.join(this._userDataDir, 'Default')
  }

  async makeTemporaryDirectory () {
    this._userDataDir = await mkdtempAsync(this.temporaryDirectoryPath)
    this._isTemporary = true
  }

  async deleteUserDataDir () {
    debug('removeUserDataDir', this._userDataDir)

    if (!this._userDataDir) {
      debug('No userDataDir, not removing')
      return
    }

    try {
      await fse.remove(this._userDataDir)
    } catch (err) {
      debug(err)
    }
  }

  async writeFilesToProfile () {
    const filesFromPlugins = this.getDataFromPlugins('userDataDirFile').map(d => d.value)
    const files = [].concat(filesFromPlugins, this._opts.files)
    if (!files.length) {
      return
    }
    for (const file of files) {
      if (file.target !== 'Profile') {
        console.warn(`Warning: Ignoring file with invalid target`, file)
        continue
      }
      const filePath = path.join(this.defaultProfilePath, file.file)
      try {
        await fse.outputFile(filePath, file.contents)
        debug(`Wrote file`, filePath)
      } catch (err) {
        console.warn('Warning: Failure writing file', filePath, file, err)
      }
    }
  }

  async beforeLaunch (options) {
    this._userDataDir = options.userDataDir
    if (!this._userDataDir) {
      await this.makeTemporaryDirectory()
      options.userDataDir = this._userDataDir
      debug('created custom dir', options.userDataDir)
    }
    await this.writeFilesToProfile()
  }

  async onDisconnected () {
    debug('onDisconnected')
    if (this.shouldDeleteDirectory) {
      await this.deleteUserDataDir()
    }
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
