# One shot target per distinct asset in a coverage level: official/generated TSStatic shapes, forest item types,
# and hand-picked generated structures. Writes a Lua table for the in-game tour.
import json, zipfile, sys, math
area, zp, out = sys.argv[1], sys.argv[2], sys.argv[3]
z=zipfile.ZipFile(zp); seen={}; T=[]
for n in z.namelist():
    if n.endswith('items.level.json'):
        for line in z.read(n).decode().splitlines():
            try: o=json.loads(line)
            except ValueError: continue
            s=o.get('shapeName'); p=o.get('position')
            if not s or not p or 'custom_assets' in s: continue
            k=s.split('/')[-1].lower()
            if k in seen: continue
            seen[k]=1; T.append({'label':k.rsplit('.',1)[0],'x':p[0],'y':p[1],'z':p[2],'kind':'model'})
forest={}
for n in z.namelist():
    if n.endswith('.forest4.json'):
        for line in z.read(n).decode().splitlines():
            try: o=json.loads(line)
            except ValueError: continue
            t=o.get('type'); p=o.get('pos')
            if t and p and t not in forest: forest[t]=p
for t,p in forest.items(): T.append({'label':t,'x':p[0],'y':p[1],'z':p[2],'kind':'tree'})
plan=json.load(open(f'scratch/levelprobe/data/{area}/coverage_plan.json'))['placed']
# (structures name their own camera: tour = [distance, yaw], from the layout itself)
for q in plan:
    if q.get('kind')=='driver':
        T.append({'label':q['what'],'x':q['at'][0],'y':q['at'][1],'z':None,'kind':'driver','heading':q['heading'],'find':q['find'],**({'fromZ':q['fromZ']} if q.get('fromZ') is not None else {})})
for q in plan:
    if q.get('kind')=='structure':
        d,yaw=(q.get('tour') or [60,0])
        T.append({'label':q['what'],'x':q['at'][0],'y':q['at'][1],'z':None,'kind':'structure','dist':d,'yaw':yaw})
for q in plan:
    w=q['what']
    if w.startswith(('building=','junction=','bridge=','tunnel=','highway=steps','highway=pedestrian','man_made=bridge','leisure=pitch','leisure=swimming_pool','leisure=track','power=substation','amenity=fuel','amenity=parking','waterway=dam','man_made=breakwater','man_made=groyne','man_made=pier','building=roof','natural=','landuse=','water=','waterway=')):
        T.append({'label':f"{w} (plot)",'x':q['at'][0],'y':q['at'][1],'z':None,'kind':'plot','dist':45,'yaw':0})
def lua(v):
    if v is None: return 'nil'
    if isinstance(v,str): return json.dumps(v)
    return repr(round(v,2)) if isinstance(v,float) else repr(v)
with open(out,'w') as f:
    f.write('covTargets = {\n'+''.join('{'+', '.join(f'{k}={lua(v)}' for k,v in t.items())+'},\n' for t in T)+'}\n')
print(len(T),'targets:',sum(t['kind']=='model' for t in T),'models,',len(forest),'tree types,',sum(t['kind']=='structure' for t in T),'structures,',sum(t['kind']=='plot' for t in T),'plots')
