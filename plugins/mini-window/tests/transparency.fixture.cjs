'use strict'
// Native Electron integration probe. No network, DSH credentials, or session data.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.commandLine.appendSwitch('disable-logging')
app.whenReady().then(async () => {
  app.setActivationPolicy?.('accessory')
  const source = fs.readFileSync(path.join(__dirname, '../src/client/styles.ts'), 'utf8')
  const css = source.match(/const styles = `([\s\S]*?)`/)[1]
  const window = new BrowserWindow({width:640,height:112,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,roundedCorners:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}})
  const html = `<html data-dsh-mini><head><style>${css}</style></head><body><div id="root"><div class="dshmini-root" data-expanded="false"><main class="dshmini-content"><div data-conversation-content><div data-conversation-scroll><div data-composer-seat><div data-slot="conversation.composer.bar"><div><div data-composer-card><div data-composer-input>Native alpha regression fixture</div></div></div></div></div></div></div></main></div></div></body></html>`
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  window.showInactive()
  const capture = async scheme => {
    await window.webContents.executeJavaScript(`document.documentElement.style.colorScheme=${JSON.stringify(scheme)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
    const image = await window.webContents.capturePage()
    const {width,height} = image.getSize()
    const bytes = image.toBitmap({scaleFactor:1})
    const pixel = (x,y) => { const i=(y*width+x)*4;return {r:bytes[i+2],g:bytes[i+1],b:bytes[i],a:bytes[i+3]} }
    return {scheme,size:{width,height},corners:[[0,0],[width-1,0],[0,height-1],[width-1,height-1],[8,8]].map(([x,y])=>pixel(x,y)),center:pixel(Math.floor(width/2),Math.floor(height/2))}
  }
  const results = [await capture('dark'),await capture('normal')]
  console.log(JSON.stringify({results}))
  window.destroy();app.quit()
}).catch(error=>{console.error(error.message);app.exit(1)})
