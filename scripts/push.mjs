#!/usr/bin/env node
/**
 * push.mjs — رفع التحديثات إلى GitHub
 *
 * الاستخدام من code_execution sandbox:
 *
 *   const conns = await listConnections('github');
 *   const token = conns[0].settings.access_token;
 *   const { execSync } = await import('child_process');
 *   execSync(`git remote set-url origin https://rrakann528:${token}@github.com/rrakann528/LrmTV.git`, { cwd: '/home/runner/workspace' });
 *   execSync('git add -A', { cwd: '/home/runner/workspace' });
 *   execSync('git commit -m "your message"', { cwd: '/home/runner/workspace' });
 *   execSync('git push --force origin main', { cwd: '/home/runner/workspace', stdio: 'inherit' });
 *   console.log('تم الرفع بنجاح!');
 *
 * ملاحظة: لا ترفع تلقائياً — انتظر حتى يقول المستخدم "ارفع التحديث"
 */
