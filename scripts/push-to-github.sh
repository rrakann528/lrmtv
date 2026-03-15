#!/bin/bash
# سكريبت نشر التحديثات إلى GitHub
# الاستخدام: bash scripts/push-to-github.sh "رسالة التعديل"

set -e

MSG="${1:-تحديث}"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN غير موجود في المتغيرات البيئية"
  exit 1
fi

git config url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
git config user.email "rrakann528@users.noreply.github.com"
git config user.name "rrakann528"

echo "📦 جمع التعديلات..."
git add -A

if git diff --cached --quiet; then
  echo "✅ لا توجد تعديلات جديدة للنشر"
  exit 0
fi

echo "💾 حفظ التعديلات: $MSG"
git commit -m "$MSG"

echo "🚀 النشر إلى GitHub..."
git push origin main

echo "✅ تم النشر بنجاح إلى rrakann528/LrmTV"
