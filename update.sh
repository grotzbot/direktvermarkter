#!/bin/bash
#sh update.sh u p
#Wenn p sonderzeichen enthält, dann muss es mit hochstrichen eingereicht werden
#
# Vollständiges Datenupdate (weltweit): fetch_regions.js geht alle Regionen
# aus regions.json sequentiell durch (dauert Stunden — für ein schnelles
# Update einzelner Regionen ist die GitHub Action "Update Data World" bzw.
# ein manuelles `node update_data.js --bbox ...` besser geeignet).
echo $1
git pull origin master

u=$1
p=$2


if [[ `git status --porcelain` ]]; then
  echo 'changes detected'
  git pull origin master
  node fetch_regions.js --regions regions.json --out out
  node build_tiles.js --out data/ out/features.json
else
  echo 'no changes detected'
  node fetch_regions.js --regions regions.json --out out
  node build_tiles.js --out data/ out/features.json
fi
echo 'loop finished'

number=$(node -p "require('./data/meta.json').count")
echo "Anzahl der Nodes: $number"
git add data/*
git commit -m "🗃 - Datenupdate $number"

if [[ $1 && $2 ]]; then
  echo 'push with variables'
  git push https://$u:$p@github.com/CodeforKarlsruhe/direktvermarkter.git
else
  echo 'push normaly'
  git push origin master
fi