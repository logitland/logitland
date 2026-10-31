"""Rasterize the editable SVG layers for Blender; requires ImageMagick.

Run with system Python after editing face.svg. Black-backed layers add together
in the face material, keeping eye motion separate from the fixed artwork.
"""
from copy import deepcopy
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

directory = Path(__file__).resolve().parent
source = ET.parse(directory/'face.svg').getroot()
magick = shutil.which('magick') or '/opt/homebrew/bin/magick'
ET.register_namespace('', 'http://www.w3.org/2000/svg')
for name in ('static', 'eye-L', 'eye-R'):
    layer = deepcopy(source)
    for child in list(layer):
        if child.get('id') not in (None, 'background', name):
            layer.remove(child)
    with tempfile.NamedTemporaryFile(suffix='.svg') as temporary:
        ET.ElementTree(layer).write(temporary.name, encoding='unicode')
        subprocess.run([magick, '-background', 'black', temporary.name,
                        '-alpha', 'off', str(directory/f'{name}.png')], check=True)
