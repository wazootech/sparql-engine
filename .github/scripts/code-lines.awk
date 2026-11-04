# Counts lines of code: skips blank, comment, and import / `export ... from`
# lines, including statements wrapped across several lines.
inblock { if ($0 ~ /^[ \t]*\}/) inblock = 0; next }
/^[ \t]*($|\/\/|\/\*|\*)/ { next }
/^[ \t]*(import|export)[ \t]/ {
  if ($0 ~ /from[ \t]+["']/ || $0 ~ /^[ \t]*import[ \t]+["']/) next
  if ($0 ~ /^[ \t]*(import|export)[ \t]+(type[ \t]*)?\{[^}]*$/) { inblock = 1; next }
}
{ n++ }
END { print n + 0 }
