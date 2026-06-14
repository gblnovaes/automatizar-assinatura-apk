require('dotenv').config();
const path = require('path');
const fs = require('fs');
const shell = require('shelljs');
const prompt = require('prompt-sync')();

const isWin = process.platform === 'win32';
const androidDir = path.join(__dirname, 'android');
const gradlew = path.join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');

const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD || prompt('Digite a senha do keystore: ', { echo: '*' });
const KEY_ALIAS = process.env.KEY_ALIAS || prompt('Digite a alias: ');
const KEY_PASSWORD = process.env.KEY_PASSWORD || prompt('Digite a senha do alias: ', { echo: '*' });

function resolveAndroidTool(toolName) {
    const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdkRoot) return toolName;

    const buildToolsDir = path.join(sdkRoot, 'build-tools');
    const versions = fs.readdirSync(buildToolsDir).sort().reverse();
    const bin = isWin ? `${toolName}.bat` : toolName;
    return path.join(buildToolsDir, versions[0], bin);
}

function runGradle(task) {
    return shell.exec(`"${gradlew}" ${task}`, { cwd: androidDir, silent: false });
}

function buildAndSignApks() {
    console.log('Iniciando processo de build e assinatura de APKs...');

    shell.rm('-rf', 'www');
    shell.rm('-rf', 'android/app/build');
    shell.rm('-rf', `${KEY_ALIAS}-release.apk`);
    shell.rm('-rf', `${KEY_ALIAS}-debug.apk`);
    shell.rm('-rf', `${KEY_ALIAS}.aab`);

    shell.exec('npx capacitor-assets generate', { silent: true });

    console.log('Gerando build do Ionic + Angular para produção...');
    const ionicBuildResult = shell.exec('npx ionic build --prod', { silent: true });
    if (ionicBuildResult.code !== 0) {
        console.error('Erro ao gerar build do Ionic:', ionicBuildResult.stderr);
        return;
    }

    console.log('Sincronizando com Android Capacitor...');
    const syncResult = shell.exec('npx cap copy && npx cap sync', { silent: true });
    if (syncResult.code !== 0) {
        console.error('Erro ao sincronizar com Android Capacitor:', syncResult.stderr);
        return;
    }

    console.log('Gerando APK de release...');
    if (runGradle('assembleRelease').code !== 0) return;

    console.log('Gerando APK de debug...');
    if (runGradle('assembleDebug').code !== 0) return;

    console.log('Gerando AAB de release...');
    if (runGradle('bundleRelease').code !== 0) return;

    const releaseApkPath = path.join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
    const signedApkPath = releaseApkPath.replace('-unsigned', '-signed.apk');
    const debugApkPath = path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    const releaseAabPath = path.join('android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');

    const keystorePath = path.join(__dirname, `${KEY_ALIAS}.jks`);
    const apksigner = resolveAndroidTool('apksigner');
    const zipalign = resolveAndroidTool('zipalign');

    console.log('Assinando APK de release...');
    const signCmd = `"${apksigner}" sign --ks "${keystorePath}" --ks-key-alias ${KEY_ALIAS} --ks-pass pass:${KEYSTORE_PASSWORD} --key-pass pass:${KEY_PASSWORD} --out "${signedApkPath}" "${releaseApkPath}"`;
    if (shell.exec(signCmd, { silent: true }).code !== 0) return;

    console.log('Otimizando APK de release...');
    const alignedApkPath = releaseApkPath.replace('-unsigned', '-aligned.apk');
    const zipalignCmd = `"${zipalign}" -v 4 "${signedApkPath}" "${alignedApkPath}"`;
    if (shell.exec(zipalignCmd, { silent: true }).code !== 0) return;

    shell.mv(signedApkPath, `${KEY_ALIAS}-release.apk`);
    shell.mv(debugApkPath, `${KEY_ALIAS}-debug.apk`);
    shell.mv(releaseAabPath, `${KEY_ALIAS}.aab`);

    console.log('Build concluído com sucesso.');
}

buildAndSignApks();
