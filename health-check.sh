# In the original repository we'll just print the result of status checks,
# without committing. This avoids generating several commits that would make
# later upstream merges messy for anyone who forked us.
commit=true
origin=$(git remote get-url origin)
if [[ $origin == *statsig-io/statuspage* ]]
then
  commit=false
fi

KEYSARRAY=()
declare -A URLBYKEY=()

# Trim leading/trailing whitespace (including stray carriage returns).
trim() {
  local v="$*"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

# If the previous check for a service was successful, we can check less often.
# Defaults are chosen to keep outages detected quickly while reducing load for
# stable services.
successIntervalMinutes=${SUCCESS_CHECK_INTERVAL_MINUTES:-5}
failureIntervalMinutes=${FAILURE_CHECK_INTERVAL_MINUTES:-5}
didWrite=false

urlsConfig="./urls.cfg"
echo "Reading $urlsConfig"
while IFS= read -r line || [[ -n "$line" ]]
do
  echo "  $line"
  line="$(trim "$line")"
  # Skip blank lines and comments.
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Split on the first '=' only, so URLs may contain '=' (e.g. query params).
  [[ "$line" != *=* ]] && continue
  key="$(trim "${line%%=*}")"
  url="$(trim "${line#*=}")"
  [[ -z "$key" || -z "$url" ]] && continue
  # De-duplicate keys; the last URL wins, matching the web UI.
  if [[ -z "${URLBYKEY[$key]+set}" ]]; then
    KEYSARRAY+=("$key")
  fi
  URLBYKEY["$key"]="$url"
done < "$urlsConfig"

echo "***********************"
echo "Starting health checks with ${#KEYSARRAY[@]} configs:"

mkdir -p logs

for key in "${KEYSARRAY[@]}"
do
  url="${URLBYKEY[$key]}"
  echo "  $key=$url"

  logFile="logs/${key}_report.log"
  shouldCheck=true
  if [[ -f "$logFile" ]]
  then
    lastEntry=$(tail -1 "$logFile")
    IFS=',' read -r lastDateRaw lastResultRaw <<< "$lastEntry"
    lastDate=$(echo "$lastDateRaw" | xargs)
    lastResult=$(echo "$lastResultRaw" | xargs)
    if [[ -n "$lastDate" && -n "$lastResult" ]]
    then
      nowEpoch=$(date +%s)
      lastEpoch=$(date -d "$lastDate" +%s 2>/dev/null)
      if [[ -n "$lastEpoch" ]]
      then
        elapsedMinutes=$(( (nowEpoch - lastEpoch) / 60 ))
        intervalMinutes=$failureIntervalMinutes
        if [[ "$lastResult" == "success" ]]
        then
          intervalMinutes=$successIntervalMinutes
        fi

        if (( elapsedMinutes < intervalMinutes ))
        then
          shouldCheck=false
          echo "    skipping check (${elapsedMinutes}m since last ${lastResult}; interval ${intervalMinutes}m)"
        fi
      fi
    fi
  fi

  if [[ $shouldCheck == false ]]
  then
    continue
  fi

  for i in 1 2 3 4; 
  do
    response=$(curl --write-out '%{http_code}' --silent --output /dev/null $url)
    if [ "$response" -eq 200 ] || [ "$response" -eq 202 ] || [ "$response" -eq 301 ] || [ "$response" -eq 302 ] || [ "$response" -eq 307 ]; then
      result="success"
    else
      result="failed"
    fi
    if [ "$result" = "success" ]; then
      break
    fi
    sleep 5
  done
  dateTime=$(date +'%Y-%m-%d %H:%M')
  if [[ $commit == true ]]
  then
    echo $dateTime, $result >> "$logFile"
    # By default we keep 2000 last log entries.  Feel free to modify this to meet your needs.
    echo "$(tail -2000 "$logFile")" > "$logFile"
    didWrite=true
  else
    echo "    $dateTime, $result"
  fi
done

if [[ $commit == true && $didWrite == true ]]
then
  # Let's make Vijaye the most productive person on GitHub.
  git config --global user.name 'Artur L.'
  git config --global user.email 'arturlauche1101@gmail.com'
  git add -A --force logs/
  git commit -am '[Automated] Update Health Check Logs'
  git push
elif [[ $commit == true ]]
then
  echo "No checks were due based on configured intervals; skipping commit."
fi
