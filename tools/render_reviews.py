"""Render verified five-star review excerpts without depending on client-side fetching."""
from pathlib import Path
import json,html,re
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'assets/reviews.json').read_text())
months=['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
reviews=data['reviews'];ids=[r['source_id'] for r in reviews]
assert len(ids)==len(set(ids)) and all(r['rating']==5 and r['text'].strip() for r in reviews)
cards=[]
for r in reviews:
 e=html.escape;month=months[int(r['date'][5:7])]+' '+r['date'][:4]
 cards.append(f'<article class="review"><div class="review-top"><span class="stars" aria-label="5 étoiles sur 5">★★★★★</span><span class="review-source">{"Extrait d’avis Airbnb" if r["excerpt"] else "Avis Airbnb"}</span></div><blockquote lang="{e(r["lang"])}">« {e(r["text"])} »</blockquote><div class="review-author"><span class="review-avatar" aria-hidden="true">{e(r["author"][0].upper())}</span><div><h3>{e(r["author"])}</h3><time datetime="{e(r["date"])}">{month}</time></div></div></article>')
p=root/'index.html';s=p.read_text();start=s.index('  <article class="review');end=s.index('</div><div class="review-controls">',start)
s=s[:start]+'  '+'\n  '.join(cards)+'\n'+s[end:];s=re.sub(r'(<span id="reviews-position"[^>]*>)1 / \d+',r'\g<1>1 / '+str(len(cards)),s)
p.write_text(s)
print(f'{len(cards)} verified five-star reviews rendered.')
