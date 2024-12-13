async = require 'async'
fs = require 'fs'
childProcess = require 'child_process'
path = require 'path'
files = require '../lib/files'

download = (url, destination, done) ->
  if fs.existsSync destination
    return process.nextTick done
  else
    command = if path.extname(url) is '.zip'
      "curl #{url} --output #{destination}.zip && unzip #{destination} && rm #{destination}.zip"
    else
      "curl #{url} --output #{destination}"

    console.log command

    curl = childProcess.exec command, cwd: files.binDir
    curl.stdout.pipe process.stdout
    curl.stderr.pipe process.stderr

    curl.on 'exit', (code) ->
      if code is 0
        return done()
      else
        return done(new Error "'#{command}' exited with code #{code}") unless code is 0

async.series [
  download.bind(@, 'http://chromedriver.storage.googleapis.com/2.8/chromedriver_mac32.zip', files.chromedriver)
  download.bind(@, 'http://saucelabs.com/downloads/Sauce-Connect-latest.zip', files.sauceConnect)
  download.bind(@, 'http://selenium.googlecode.com/files/selenium-server-standalone-2.35.0.jar', files.seleniumServer)
  ->
    unless fs.existsSync files.chromedriverVerbose
      command = "#{files.chromedriver} --verbose $*"
      fs.writeFileSync files.chromedriverVerbose, """
        echo "running #{command}"
        #{command}
      """
      fs.chmodSync files.chromedriverVerbose, 0o777
  ->
    console.log 'successfully downloaded chromedriver binaries.'
]

