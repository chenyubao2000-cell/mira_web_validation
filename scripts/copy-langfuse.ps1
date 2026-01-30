# 从 langfuse 复制 runner 所需文件到 mira_evaluation
$langfuse = "D:\code\langfuse"
$runner = "D:\code\mira_evaluation\lib\runner"

Copy-Item "$langfuse\evaluator-prompts.json" "$runner\" -Force
Copy-Item "$langfuse\evaluators\datas\toolsForValidation.json" "$runner\evaluators\datas\" -Force
Copy-Item "$langfuse\evaluators\datas\dataset" "$runner\evaluators\datas\dataset" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done. Config and evaluator JS files are created by the migration."
