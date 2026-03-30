#!/bin/bash
# سكريبت نشر التحديثات إلى GitHub
# الاستخدام: bash scripts/push-to-github.sh "رسالة التعديل"

MSG="${1:-تحديث}"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN غير موجود في المتغيرات البيئية"
  exit 1
fi

echo "🚀 النشر إلى GitHub..."
git push "https://${GITHUB_TOKEN}@github.com/rrakann528/LrmTV.git" main

echo "✅ تم النشر بنجاح إلى rrakann528/LrmTV"
