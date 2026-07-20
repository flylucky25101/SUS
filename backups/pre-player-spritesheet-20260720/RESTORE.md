# Player sprite integration rollback

Run these commands from the project root in PowerShell to restore the files that existed before the sprite integration:

```powershell
Copy-Item -Force backups\pre-player-spritesheet-20260720\src\render\ArenaScene.ts src\render\ArenaScene.ts
Copy-Item -Force backups\pre-player-spritesheet-20260720\src\ui\App.ts src\ui\App.ts
Copy-Item -Force backups\pre-player-spritesheet-20260720\public\sw.js public\sw.js
Copy-Item -Force backups\pre-player-spritesheet-20260720\eslint.config.js eslint.config.js

Remove-Item src\render\SpriteAnimator.ts
Remove-Item src\render\sprite-animation.ts
Remove-Item tests\unit\sprite-animation.test.ts
Remove-Item tests\e2e\sprite-animation.spec.ts
Remove-Item scripts\pack-player-spritesheet.py
Remove-Item public\assets\player-spritesheet.png
```

The sprite image did not exist before this change, so there is no older image asset to restore.
