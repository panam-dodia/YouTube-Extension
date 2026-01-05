@echo off
REM Google Cloud Speech-to-Text Setup Script for Windows
REM This script helps you set up Google Cloud credentials for the TalkBridge backend

echo.
echo ======================================
echo Google Cloud Speech-to-Text Setup
echo ======================================
echo.

REM Check if gcloud is installed
where gcloud >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Google Cloud SDK ^(gcloud^) is not installed.
    echo.
    echo Please install it first:
    echo   Download: https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe
    echo   Or visit: https://cloud.google.com/sdk/docs/install#windows
    echo.
    pause
    exit /b 1
)

echo [OK] Google Cloud SDK found
echo.

REM Variables
set SERVICE_ACCOUNT_NAME=talkbridge-stt
set KEY_FILE=google-cloud-key.json

REM Step 1: Login
echo ==============================
echo Step 1: Login to Google Cloud
echo ==============================
echo.
pause
call gcloud auth login

echo.
echo ===================================
echo Step 2: Select or Create Project
echo ===================================
echo.
echo Your existing projects:
call gcloud projects list
echo.
set /p PROJECT_ID="Enter your project ID (leave empty to create new): "

if "%PROJECT_ID%"=="" (
    set /p NEW_PROJECT_ID="Enter a new project ID (e.g., talkbridge-app): "
    set /p PROJECT_NAME="Enter project name (e.g., TalkBridge): "

    echo Creating project...
    call gcloud projects create !NEW_PROJECT_ID! --name="!PROJECT_NAME!"
    set PROJECT_ID=!NEW_PROJECT_ID!
)

REM Set the project
echo Setting active project to: %PROJECT_ID%
call gcloud config set project %PROJECT_ID%

echo.
echo ===================================
echo Step 3: Enable Speech-to-Text API
echo ===================================
call gcloud services enable speech.googleapis.com
echo [OK] Speech-to-Text API enabled

echo.
echo ================================
echo Step 4: Create Service Account
echo ================================

REM Check if service account exists
call gcloud iam service-accounts describe %SERVICE_ACCOUNT_NAME%@%PROJECT_ID%.iam.gserviceaccount.com >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Service account already exists: %SERVICE_ACCOUNT_NAME%@%PROJECT_ID%.iam.gserviceaccount.com
) else (
    echo Creating service account...
    call gcloud iam service-accounts create %SERVICE_ACCOUNT_NAME% --display-name="TalkBridge Speech-to-Text Service Account" --description="Service account for TalkBridge live translation feature"
    echo [OK] Service account created
)

echo.
echo ==========================
echo Step 5: Grant Permissions
echo ==========================
call gcloud projects add-iam-policy-binding %PROJECT_ID% --member="serviceAccount:%SERVICE_ACCOUNT_NAME%@%PROJECT_ID%.iam.gserviceaccount.com" --role="roles/speech.client"
echo [OK] Permissions granted

echo.
echo ==================================
echo Step 6: Create and Download Key
echo ==================================
if exist "%KEY_FILE%" (
    set /p OVERWRITE="[WARNING] Key file already exists. Overwrite? (y/n): "
    if /i not "%OVERWRITE%"=="y" (
        echo Keeping existing key file.
        goto end
    )
    del "%KEY_FILE%"
)

echo Creating key file...
call gcloud iam service-accounts keys create %KEY_FILE% --iam-account=%SERVICE_ACCOUNT_NAME%@%PROJECT_ID%.iam.gserviceaccount.com

echo [OK] Key file created: %KEY_FILE%

echo.
echo =========================
echo Step 7: Update .env file
echo =========================

REM Update .env file
powershell -Command "(Get-Content .env) -replace 'GOOGLE_APPLICATION_CREDENTIALS=.*', 'GOOGLE_APPLICATION_CREDENTIALS=./%KEY_FILE%' | Set-Content .env"
echo [OK] Updated .env file

:end
echo.
echo ==================
echo Setup Complete!
echo ==================
echo.
echo Summary:
echo   Project ID: %PROJECT_ID%
echo   Service Account: %SERVICE_ACCOUNT_NAME%@%PROJECT_ID%.iam.gserviceaccount.com
echo   Key File: %KEY_FILE%
echo.
echo Next steps:
echo   1. Restart your backend server
echo   2. Test the live translation feature
echo.
echo [WARNING] IMPORTANT: Keep your %KEY_FILE% secure and never commit it to git!
echo.
pause
