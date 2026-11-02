"""Retain soft room shapes in the opposite color to each avatar's accents.

Run with system Python and Pillow. Keep the original plate as the art source.
"""
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps

folder = Path(__file__).resolve().parent
source = Image.open(folder/'command-room.png').convert('RGB')
shapes = ImageOps.grayscale(source.filter(ImageFilter.GaussianBlur(12)))
shapes = ImageOps.autocontrast(shapes, cutoff=1)
shapes = shapes.point(lambda value: round(255*(value/255)**.85))
for palette, dark, light in (
    ('blue', '#102442', '#469bd6'),
    ('pink', '#30142d', '#c454a5'),
):
    plate = ImageOps.colorize(shapes, black=dark, white=light)
    plate.save(folder/f'command-room-{palette}.png', optimize=True)
