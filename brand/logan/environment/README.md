# Portrait environment

`studio_small_09_2k.hdr` is **Studio Small 09** by Sergej Majboroda, from
[Poly Haven](https://polyhaven.com/a/studio_small_09), released under
[CC0](https://polyhaven.com/license). It provides unclipped studio reflections.

`command-room.png` was generated with `gpt-image-2.5` through the image-gen skill.
It is a square, defocused server-room background plate with a dark center,
magenta practical lights on the left and blue practical lights on the right.
It is an ordinary image, not an HDR lighting map. The camera-only plane keeps
its painted lights separate from the actual HDRI and portrait lights.

`command-room-blue.png` and `command-room-pink.png` retain the room's broad
shapes with softened detail and a single color palette. Production uses blue
behind pink Logan; staging uses pink behind blue Logan. Regenerate both with
`python3 soften-background.py`. The plates and HDRI are packed into the studio.
