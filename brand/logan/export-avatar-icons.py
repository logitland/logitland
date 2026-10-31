"""Export Discord upload images and a circular size-check sheet from the renders.

Run with Python and Pillow after rendering both avatar scenes.
Upload the square 512px PNGs; Discord applies its own circular mask.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

folder = Path(__file__).resolve().parent/'renders'
sheet = Image.new('RGB', (1040, 750), '#151720')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 24)
small = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 16)

for column, (stem, title) in enumerate((('logan-avatar', 'LOGAN'), ('logan-staging-avatar', 'LOGAN / STAGING'))):
    original = Image.open(folder/(stem+'.png')).convert('RGB')
    original.resize((512, 512), Image.Resampling.LANCZOS).save(folder/(stem+'-512.png'), optimize=True)
    x = 20+column*520
    draw.text((x+15, 20), title, font=font, fill='#f0edf5')
    for size, y, offset in ((460, 70, 15), (128, 570, 15), (64, 570, 190), (32, 570, 310)):
        # Supersample the circular boundary, just as a browser would.
        mask = Image.new('L', (size*4, size*4))
        ImageDraw.Draw(mask).ellipse((0, 0, size*4-1, size*4-1), fill=255)
        mask = mask.resize((size, size), Image.Resampling.LANCZOS)
        thumb = original.resize((size, size), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x+offset, y), mask)
        if size != 460:
            draw.text((x+offset, y+size+10), f'{size}px', font=small, fill='#a6a8b8')
sheet.save(folder/'logan-avatar-size-check.jpg', quality=92)
