#!/bin/bash
echo $1
git pull origin master
if [[ `git status --porcelain` ]]; then
  echo 'changes detected'
  git pull origin master
  node update_data.js
else
  echo 'no changes detected'
  node update_data.js
fi
echo 'loop finished'

number=$(find data -type f | wc -l)
let number-=2
echo "Anzahl der Nodes: $number"
git add data/*
git commit -m "Datenupdate $number"
git push origin master