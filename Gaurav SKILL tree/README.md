# Gaurav's skill tree

A private, animated skill tree built from my own commits in WBT Command HQ, Deligro and Orbis, to help write my CV.

**To open it:** double-click `start.cmd`, then go to http://localhost:3000 if the page doesn't open by itself.

**To use it:**
- Click a stone to see the skill, a line for my CV, and the commits that prove it.
- Drag to move around, scroll to zoom, and press Fit to go back.
- Press "Replay the climb" to watch the tree grow from my first commit to my latest.
- Press "My CV list" to copy every CV line at once.

**Live updates:** while the tree's server is running, it checks my commits every 15 minutes. If a skill is unlocked, the page celebrates, the lock-screen picture updates and Windows shows a notification. `turn-off-live.cmd` turns all of this off and puts Windows Spotlight back on the lock screen.

**Privacy:** this folder is not part of the WBT project or its git. The page only answers this computer, makes no outside requests, and has client names and email addresses removed.

**To update it with newer commits:** this happens by itself while the server runs. To add another project, ask Claude to add it to the list in `tools/update.mjs`.
