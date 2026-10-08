#!/bin/bash
# Fix REQ-068 M2 remaining: re-point KPI cards to inventoryReports/get_stats.php in admin+supervisor twins
WT="C:/Users/Jerico/orca/workspaces/HouseOfFriesLiveDomain/master-3-opencode"
cd "$WT" || exit 1

for role in admin supervisor; do
  for f in stock_in stock_out spoilage adjustments returns; do
    js="javascript/$role/$f.js"
    [ -f "$js" ] || continue
    # swap the stats read (result.stats / json.stats) for the new endpoint's data shape
    perl -0pi -e 's/result\.stats\?\.total\b/result?.data?.total/g; s/result\.stats\?\.low\b/result?.data?.low/g; s/result\.stats\?\.out\b/result?.data?.out/g; s/result\.stats\?\.damaged\b/result?.data?.damaged/g; s/result\.stats\.total\b/result.data?.total/g; s/result\.stats\.low\b/result.data?.low/g; s/result\.stats\.out\b/result.data?.out/g; s/result\.stats\.damaged\b/result.data?.damaged/g; s/json\.stats\?\.total\b/json.data?.total/g; s/json\.stats\?\.low\b/json.data?.low/g; s/json\.stats\?\.out\b/json.data?.out/g; s/json\.stats\?\.damaged\b/json.data?.damaged/g; s/stats\.total\b/data?.total/g; s/stats\.low\b/data?.low/g; s/stats\.out\b/data?.out/g; s/stats\.damaged\b/data?.damaged/g' "$js"
    echo "patched $js"
  done
done

# Also the adjustment twins' updateQuickStatsFromBackend reads `s.total/l...`
perl -0pi -e 's/s\.total \?\? 0/s.total ?? 0/g; s/s\.low \?\? 0/s.low ?? 0/g; s/s\.out \?\? 0/s.out ?? 0/g; s/s\.damaged \?\? 0/s.damaged ?? 0/g' javascript/admin/adjustments.js javascript/supervisor/adjustments.js

# Point the KPI fetch at the inventoryReports endpoint: in each file the material fetch stays,
# but add a SEPARATE stats fetch. Simplest robust approach: after the existing get_materials fetch
# resolves, ALSO fetch inventoryReports/get_stats.php and write the 4 ids. We do this by appending
# a small stats call to each file's existing stats function where it exists.
echo "done patching reads"
