# Paused for laptop update

User wants the crossed-arm pose from the image-generated banner, specifically upper arms angled outward rather than hanging straight down. No delegates. Main avatar-studio.blend remains unchanged; all experiments ran in background copies.

Source studio: ../avatar-studio.blend. Banner reference: ../renders/logan-banner-generated.png. Working branch t3/logan-mascot-blender-model, last pushed 9b42cd2.

This folder preserves /tmp work across reboot. pose-banner-study.py is the latest experiment; it loads the studio, solves shoulders/elbows with fixed-length FK bones, keys frame 80 in a copied action, changes hands, saves /tmp/logan-banner-pose-study.blend, then renders a square upper-body inspection. The script currently tests 18% forearm length extension with matching drape scale and scale inheritance disabled on hands/cuffs. This extension is experimental and not accepted or visually verified. The latest invocation stopped after loading the studio; the saved blend may still be the previous v5 study. Read the log and inspect before trusting it.

v1-v5 previews document attempts. V2 preserved original hand rotations but exposed the outward-facing hand. V3 raised the forearm stack too high and buried the hands. V4 lowered the crossing and spread elbows, but the upward hand pointed toward the collar. V5 flattened that hand toward the opposite bicep, but reach/contact still needs work. Nothing is ready to apply to the main studio.

Current coat Crossed arms cloth shape key was sculpted for the old pose. It remains on in these studies. Disabling it opened a collar gap and did not fix the sleeve shape. Refit locally if needed; do not run fit-crossed-cloth.py blindly because it reinstates old authored targets. Hands have only armature modifiers. Rig FK/IK controls are correctly anchored at wrists. Do not move hand mesh objects.

The current production/staging avatars and generated banner are complete and pushed. Do not regenerate them or overwrite the user's camera while doing the pose study. User explicitly paused work; resume only when asked.
