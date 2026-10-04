"""Deployment commands. Administrative commands require shell/DB operator access."""
import argparse,os,time,json,signal
from sqlalchemy import select,insert,update
from . import db as d
from .config import Settings
from .common import canonical

def main():
    p=argparse.ArgumentParser(description='FillMyCourt shared platform')
    p.add_argument('command',choices=['serve','migrate','worker','projector','reconciliation-worker','provider-sync-worker','verify-club','grant-role'])
    p.add_argument('--venue');p.add_argument('--actor');p.add_argument('--evidence');p.add_argument('--player');p.add_argument('--role',choices=['owner','manager','staff','accountant','viewer'])
    args=p.parse_args();settings=Settings.from_env();settings.validate()
    if args.command=='serve':
        import uvicorn
        uvicorn.run('fmc.app:create_app',factory=True,host='0.0.0.0',port=int(os.getenv('PORT','8000')),proxy_headers=False,access_log=False)
        return
    db=d.Store(settings.database,settings.environment in ('staging','production'),initialize=False)
    if args.command=='migrate':db.migrate();print('Schema ready; no customers or inventory seeded.');return
    if args.command in ('verify-club','grant-role'):
        if not args.venue or not args.actor or not args.evidence:raise SystemExit('--venue --actor --evidence are required')
        with db.tx() as c:
            v=db.lock(c,d.venues,id=args.venue)
            if not v:raise SystemExit('Unknown venue')
            if args.command=='verify-club':
                data=json.loads(v['data']);data['admin_verified']=True;c.execute(update(d.venues).where(d.venues.c.id==v['id']).values(data=canonical(data)))
            else:
                if not args.player or not args.role or not d.one(c,select(d.players).where(d.players.c.id==args.player)):raise SystemExit('A previously authenticated player and role are required')
                if d.one(c,select(d.members).filter_by(organisation_id=v['organisation_id'],player_id=args.player)):raise SystemExit('Membership exists; use a reviewed migration for role changes')
                c.execute(insert(d.members).values(organisation_id=v['organisation_id'],player_id=args.player,role=args.role))
            db.emit(c,v['id'],args.actor,'admin.'+args.command,args.player or v['id'],{'evidence':args.evidence,'role':args.role})
        print('Administrative action recorded.');return
    if args.command in ('reconciliation-worker','provider-sync-worker'):
        from .worker_runtime import run
        run(db,args.command)
        return
    from .jobs import Worker,Projector
    if args.command=='worker': worker=Worker(db)
    else: worker=Projector(db)
    running=True
    def stop(*_):
        nonlocal running
        running=False
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    while running:
        worked=worker.step()
        if not worked:time.sleep(1)
if __name__=='__main__':main()
