# ALL 아트 오버홀 이전 상태로 복원

아래 명령은 프로젝트 루트 `C:\Users\flylucky10201\Documents\SuperUltimateSmash`에서 PowerShell로 실행합니다.

```powershell
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\src\render\ArenaScene.ts' -Destination '.\src\render\ArenaScene.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\src\render\SpriteAnimator.ts' -Destination '.\src\render\SpriteAnimator.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\src\render\sprite-animation.ts' -Destination '.\src\render\sprite-animation.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\src\ui\App.ts' -Destination '.\src\ui\App.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\src\ui\i18n.ts' -Destination '.\src\ui\i18n.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\src\styles.css' -Destination '.\src\styles.css' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\public\sw.js' -Destination '.\public\sw.js' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\public\assets\player-spritesheet.png' -Destination '.\public\assets\player-spritesheet.png' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\playwright.config.ts' -Destination '.\playwright.config.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\playwright.pwa.config.ts' -Destination '.\playwright.pwa.config.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\tests\e2e\sprite-animation.spec.ts' -Destination '.\tests\e2e\sprite-animation.spec.ts' -Force
Copy-Item -LiteralPath '.\backups\pre-all-art-overhaul-20260720\tests\e2e\visual.spec.ts' -Destination '.\tests\e2e\visual.spec.ts' -Force

Remove-Item -LiteralPath '.\public\assets\fighters' -Recurse -Force
Remove-Item -LiteralPath '.\public\assets\stages' -Recurse -Force
Remove-Item -LiteralPath '.\public\assets\ui' -Recurse -Force
Remove-Item -LiteralPath '.\tests\e2e\all-art.spec.ts' -Force
```

마지막으로 아래 검증을 실행합니다.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`scripts/pack-player-spritesheet.py`의 선택적 `--final-pose` 지원과 QA 캡처 파일은 런타임에 영향을 주지 않으므로 남겨도 됩니다. 완전히 정리하려면 `artifacts\sprites\all-fighters`와 이번에 생성된 `artifacts\screenshots\shop.png`도 삭제할 수 있습니다.
