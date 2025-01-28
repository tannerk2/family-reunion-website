# deploy.ps1

param(
    [Parameter(Mandatory=$true)]
    [string]$StackName,
    
    [Parameter(Mandatory=$true)]
    [string]$TemplateFile,
    
    [Parameter(Mandatory=$false)]
    [string]$DomainName = "wadsworth-reunion-stack",

    [Parameter(Mandatory=$false)]
    [string]$Region = "us-east-1",

    [Parameter(Mandatory=$false)]
    [string]$AcmCertificateArn = "arn:aws:acm:us-east-1:629430435133:certificate/63f395d0-1cc8-4569-b96f-030201adbd0d"
)

# Set AWS region for this session
$env:AWS_DEFAULT_REGION = $Region

# Validate template first
Write-Host "Validating template in region $Region..." -ForegroundColor Yellow
aws cloudformation validate-template --template-body file://$TemplateFile --region $Region

if ($LASTEXITCODE -eq 0) {
    Write-Host "Template validation successful!" -ForegroundColor Green
    
    # Deploy the stack
    Write-Host "Deploying stack to $Region..." -ForegroundColor Yellow
    
    $deployCommand = "aws cloudformation deploy " +
                    "--template-file $TemplateFile " +
                    "--stack-name $StackName " +
                    "--parameter-overrides DomainName=$DomainName " +
                    "--parameter-overrides AcmCertificateArn=$AcmCertificateArn " +
                    "--capabilities CAPABILITY_IAM " +
                    "--region $Region " +
                    "--no-fail-on-empty-changeset"
    
    Write-Host "Executing: $deployCommand" -ForegroundColor Gray
    Invoke-Expression $deployCommand
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Deployment successful!" -ForegroundColor Green
        
        # Get stack outputs
        Write-Host "`nStack Outputs:" -ForegroundColor Yellow
        aws cloudformation describe-stacks --stack-name $StackName --region $Region --query 'Stacks[0].Outputs' --output table
    }
    else {
        Write-Host "Deployment failed!" -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "Template validation failed!" -ForegroundColor Red
    exit 1
}