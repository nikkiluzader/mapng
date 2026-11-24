import re, sys, os
from PIL import Image, ImageDraw, ImageFont
src, tl, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
T=[dict(re.findall(r'(\w+)=("[^"]*"|[^,}]+)', l)) for l in open(tl) if l.startswith('{')]
lab=lambda i:(T[i]['kind'].strip('"')+': '+T[i]['label'].strip('"'))
files=sorted(f for f in os.listdir(src) if f.endswith('.jpg'))
W,H,C,R=560,315,4,3
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',15)
except OSError: font=ImageFont.load_default()
for s in range(0,len(files),C*R):
    sheet=Image.new('RGB',(W*C,H*R),'white'); d=ImageDraw.Draw(sheet)
    for j,f in enumerate(files[s:s+C*R]):
        i=int(f[:3])-1; im=Image.open(os.path.join(src,f)).convert('RGB'); im.thumbnail((W,H))
        x,y=(j%C)*W,(j//C)*H; sheet.paste(im,(x,y))
        t=f"{i+1} {lab(i)}"[:62]; d.rectangle([x,y,x+W,y+20],fill=(0,0,0)); d.text((x+4,y+2),t,fill=(255,255,0),font=font)
    sheet.save(os.path.join(out,f'sheet_{s//(C*R)+1:02d}.jpg'),quality=88)
print('sheets:',(len(files)+C*R-1)//(C*R))
