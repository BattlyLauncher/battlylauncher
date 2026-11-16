import { app, dialog } from 'electron';
import { basename } from 'node:path';
import { PrivateDataDecryptionError } from './protected-data';
import { canResetPrivateFile, resetPrivateFile, restorePrivateFile } from './private-data-recovery';
import { translateDialogOptions } from '../i18n/native-language';

export async function offerPrivateStorageRecovery(
  root: string,
  error: unknown,
  translate: (text: string) => string = (text) => text,
): Promise<boolean> {
  if (!(error instanceof PrivateDataDecryptionError)) {
    return false;
  }
  if (await restorePrivateFile(root, error)) {
    app.relaunch();
    app.exit(0);
    return true;
  }
  const resettable = canResetPrivateFile(root, error);
  const result = await dialog.showMessageBox(
    translateDialogOptions(
      {
        type: 'warning',
        title: 'Battly · Recuperar datos locales',
        message: `Battly no puede leer el archivo «${basename(error.filePath)}».`,
        detail: resettable
          ? 'Puedes reparar solo este archivo. Se guardará una copia del original antes de restablecerlo. Si contiene tu sesión o tus preferencias, tendrás que iniciar sesión o configurarlas de nuevo. Tus versiones, instancias, mods y mundos no se borran.'
          : 'El archivo original se conserva. No se borrará ni se sustituirá su contenido. Comprueba que estás usando la cuenta original del sistema y restaura una copia del archivo si dispones de ella.',
        buttons: resettable
          ? ['Reparar este archivo', 'Volver a intentar', 'Cerrar']
          : ['Volver a intentar', 'Cerrar'],
        defaultId: resettable ? 1 : 0,
        cancelId: resettable ? 2 : 1,
        noLink: true,
      },
      translate,
    ),
  );
  if (resettable && result.response === 0) {
    await resetPrivateFile(root, error);
    app.relaunch();
  } else if (result.response === (resettable ? 1 : 0)) {
    app.relaunch();
  }
  app.exit(0);
  return true;
}
