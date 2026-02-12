const maxDays = 30;

async function genReportLog(container, key, url) {
  const response = await fetch("logs/" + key + "_report.log");
  let statusLines = "";
  if (response.ok) {
    statusLines = await response.text();
  }

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(key, url, normalized);
  container.appendChild(statusStream);
}

function constructStatusStream(key, url, uptimeData) {
  let streamContainer = templatize("statusStreamContainerTemplate");
  for (var ii = maxDays - 1; ii >= 0; ii--) {
    let line = constructStatusLine(key, ii, uptimeData.dailyAverages[ii], uptimeData.dailyStats[ii]);
    streamContainer.appendChild(line);
  }

  const lastSet = uptimeData.dailyAverages[0];
  const color = getColor(lastSet);

  const container = templatize("statusContainerTemplate", {
    title: key,
    url: url,
    color: color,
    status: getStatusText(color),
    upTime: uptimeData.upTime,
    incidentCount: uptimeData.incidentCount,
    outageTime: uptimeData.totalEstimatedDowntime,
  });

  container.appendChild(streamContainer);
  return container;
}

function constructStatusLine(key, relDay, upTimeValue, dayStats) {
  let date = new Date();
  date.setDate(date.getDate() - relDay);

  return constructStatusSquare(key, date, upTimeValue, dayStats);
}

function getColor(uptimeVal) {
  return uptimeVal == null
    ? "nodata"
    : uptimeVal == 1
    ? "success"
    : uptimeVal < 0.3
    ? "failure"
    : "partial";
}

function constructStatusSquare(key, date, uptimeVal, dayStats) {
  const color = getColor(uptimeVal);
  let square = templatize("statusSquareTemplate", {
    color: color,
    tooltip: getTooltip(key, date, color),
  });

  const show = () => {
    showTooltip(square, key, date, color, dayStats);
  };
  square.addEventListener("mouseover", show);
  square.addEventListener("mousedown", show);
  square.addEventListener("mouseout", hideTooltip);
  return square;
}

let cloneId = 0;
function templatize(templateId, parameters) {
  let clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "template_clone_" + cloneId++;
  if (!parameters) {
    return clone;
  }

  applyTemplateSubstitutions(clone, parameters);
  return clone;
}

function applyTemplateSubstitutions(node, parameters) {
  const attributes = node.getAttributeNames();
  for (var ii = 0; ii < attributes.length; ii++) {
    const attr = attributes[ii];
    const attrVal = node.getAttribute(attr);
    node.setAttribute(attr, templatizeString(attrVal, parameters));
  }

  if (node.childElementCount == 0) {
    node.innerText = templatizeString(node.innerText, parameters);
  } else {
    const children = Array.from(node.children);
    children.forEach((n) => {
      applyTemplateSubstitutions(n, parameters);
    });
  }
}

function templatizeString(text, parameters) {
  if (parameters) {
    for (const [key, val] of Object.entries(parameters)) {
      text = text.replaceAll("$" + key, val);
    }
  }
  return text;
}

function getStatusText(color) {
  return color == "nodata"
    ? "No Data Available"
    : color == "success"
    ? "Fully Operational"
    : color == "failure"
    ? "Major Outage"
    : color == "partial"
    ? "Partial Outage"
    : "Unknown";
}

function getStatusDescriptiveText(color, dayStats) {
  if (color == "nodata") {
    return "No Data Available: Health check was not performed.";
  }

  const failedChecks = dayStats ? dayStats.failedChecks : 0;
  const totalChecks = dayStats ? dayStats.totalChecks : 0;
  const downtime = dayStats ? dayStats.estimatedDowntime : "0m";
  const outageWindow = dayStats && dayStats.firstFailureTime
    ? `Outage window: ${dayStats.firstFailureTime} - ${dayStats.lastFailureTime}.`
    : "No failed checks in this period.";

  if (color == "success") {
    return `No downtime recorded on this day. ${totalChecks} checks ran.`;
  }

  return `${failedChecks} failed checks out of ${totalChecks}. Estimated downtime: ${downtime}. ${outageWindow}`;
}

function getTooltip(key, date, quartile, color) {
  let statusText = getStatusText(color);
  return `${key} | ${date.toDateString()} : ${quartile} : ${statusText}`;
}

function normalizeData(statusLines) {
  const rows = statusLines.split("\n");
  const dateNormalized = splitRowsByDate(rows);

  let dailyAverages = {};
  let dailyStats = {};
  const now = Date.now();
  for (const [key, val] of Object.entries(dateNormalized.byDay)) {
    const relDays = getRelativeDays(now, new Date(key).getTime());
    dailyAverages[relDays] = getDayAverage(val.results);
    dailyStats[relDays] = summarizeDayStats(val);
  }

  return {
    dailyAverages,
    dailyStats,
    upTime: dateNormalized.upTime,
    incidentCount: dateNormalized.incidentCount,
    totalEstimatedDowntime: formatMinutes(dateNormalized.totalEstimatedDowntimeMinutes),
  };
}

function summarizeDayStats(dayValue) {
  const totalChecks = dayValue.results.length;
  const failedChecks = dayValue.results.filter((result) => result === 0).length;
  const estimatedDowntimeMinutes = totalChecks
    ? Math.round((failedChecks / totalChecks) * 1440)
    : 0;

  return {
    totalChecks,
    failedChecks,
    estimatedDowntime: formatMinutes(estimatedDowntimeMinutes),
    firstFailureTime: dayValue.firstFailureTime,
    lastFailureTime: dayValue.lastFailureTime,
  };
}

function getDayAverage(val) {
  if (!val || val.length == 0) {
    return null;
  }
  return val.reduce((a, v) => a + v) / val.length;
}

function getRelativeDays(date1, date2) {
  return Math.floor(Math.abs((date1 - date2) / (24 * 3600 * 1000)));
}

function splitRowsByDate(rows) {
  let byDay = {};
  let sum = 0;
  let count = 0;
  let incidentCount = 0;
  let totalEstimatedDowntimeMinutes = 0;

  for (var ii = 0; ii < rows.length; ii++) {
    const row = rows[ii];
    if (!row) {
      continue;
    }

    const [dateTimeStr, resultStr] = row.split(",", 2);
    const dateTime = new Date(Date.parse(dateTimeStr.replace(/-/g, "/") + " GMT"));
    const dateStr = dateTime.toDateString();

    let dayContainer = byDay[dateStr];
    if (!dayContainer) {
      dayContainer = {
        results: [],
        firstFailureTime: null,
        lastFailureTime: null,
      };
      byDay[dateStr] = dayContainer;
      if (Object.keys(byDay).length > maxDays) {
        break;
      }
    }

    const isSuccess = resultStr.trim() == "success";
    const result = isSuccess ? 1 : 0;

    if (!isSuccess) {
      const timeValue = dateTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!dayContainer.firstFailureTime) {
        dayContainer.firstFailureTime = timeValue;
      }
      dayContainer.lastFailureTime = timeValue;
    }

    sum += result;
    count++;
    dayContainer.results.push(result);
  }

  for (const dayValue of Object.values(byDay)) {
    const totalChecks = dayValue.results.length;
    const failedChecks = dayValue.results.filter((result) => result === 0).length;
    if (failedChecks > 0) {
      incidentCount++;
    }

    if (totalChecks > 0) {
      totalEstimatedDowntimeMinutes += Math.round((failedChecks / totalChecks) * 1440);
    }
  }

  const upTime = count ? ((sum / count) * 100).toFixed(2) + "%" : "--%";
  return {
    byDay,
    upTime,
    incidentCount,
    totalEstimatedDowntimeMinutes,
  };
}

function formatMinutes(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hrs}h`;
  }
  return `${hrs}h ${mins}m`;
}

let tooltipTimeout = null;
function showTooltip(element, key, date, color, dayStats) {
  clearTimeout(tooltipTimeout);
  const toolTipDiv = document.getElementById("tooltip");

  document.getElementById("tooltipDateTime").innerText = `${key} • ${date.toDateString()}`;
  document.getElementById("tooltipDescription").innerText = getStatusDescriptiveText(color, dayStats);

  const statusDiv = document.getElementById("tooltipStatus");
  statusDiv.innerText = getStatusText(color);
  statusDiv.className = `tooltipStatus ${color}`;

  toolTipDiv.style.top = element.offsetTop + element.offsetHeight + 10;
  toolTipDiv.style.left =
    element.offsetLeft + element.offsetWidth / 2 - toolTipDiv.offsetWidth / 2;
  toolTipDiv.style.opacity = "1";
}

function hideTooltip() {
  tooltipTimeout = setTimeout(() => {
    const toolTipDiv = document.getElementById("tooltip");
    toolTipDiv.style.opacity = "0";
  }, 1000);
}

async function genAllReports() {
  const response = await fetch("urls.cfg");
  const configText = await response.text();
  const configLines = configText.split("\n");
  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key, url] = configLine.split("=");
    if (!key || !url) {
      continue;
    }

    await genReportLog(document.getElementById("reports"), key, url);
  }
}
