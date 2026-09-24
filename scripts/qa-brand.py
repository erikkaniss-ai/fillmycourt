from pathlib import Path
import asyncio,json,threading,functools
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
ROOT=Path.cwd();OS=(ROOT/'cases/fillmycourt.html').exists()
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
async def main():
 results=[];sem=asyncio.Semaphore(4);out=ROOT/'.qa';out.mkdir(exist_ok=True)
 paths=['index.html','ventures.html']+[str(p.relative_to(ROOT)) for p in (ROOT/'cases').glob('*.html')] if OS else [str(p.relative_to(ROOT)) for p in ROOT.rglob('*.html') if not any(x in p.parts for x in ['.git','archive','.qa'])]
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True)
  async def run(path,w):
   async with sem:
    pg=await b.new_page(viewport={'width':w,'height':900});errors=[]
    pg.on('pageerror',lambda e:errors.append(str(e)))
    await pg.goto('http://127.0.0.1:8765/'+path,wait_until='domcontentloaded');await pg.wait_for_timeout(200)
    data=await pg.evaluate('''()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src)})''')
    data.update(path=path,errors=errors)
    if path in ('index.html','en/index.html','ventures.html','cases/fillmycourt.html'):
     await pg.screenshot(path=str(out/(path.replace('/','-')+'-'+str(w)+'.png')),full_page=False)
    toggle=pg.locator('.fmc-menu-toggle' if not OS else '.menu-toggle')
    if w==390 and await toggle.count() and await toggle.first.is_visible():
     await toggle.first.click();data['menuExpanded']=await toggle.first.get_attribute('aria-expanded');await pg.keyboard.press('Escape')
    results.append(data);await pg.close()
  await asyncio.gather(*[run(path,w) for path in paths for w in (390,1440)])
  await b.close()
 server.shutdown();(out/'brand-qa.json').write_text(json.dumps(results,indent=2))
 failures=[x for x in results if x['scroll']>x['width']+2 or x['errors'] or x.get('menuExpanded','true')!='true']
 print('BRAND_QA '+json.dumps({'pages':len(paths),'viewports':[390,1440],'checks':len(results),'layoutOrJsFailures':failures,'brokenImages':[x for x in results if x['broken']]}))
 if failures:raise SystemExit(1)
asyncio.run(main())
