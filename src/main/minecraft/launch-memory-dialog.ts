import type { MessageBoxOptions } from 'electron';
import type { LaunchMemoryAssessment, LaunchMemoryDecision } from './launch-memory-preflight';

export function launchMemoryDialog(
  assessment: LaunchMemoryAssessment,
  text: (source: string) => string,
): {
  options: MessageBoxOptions;
  decisions: LaunchMemoryDecision[];
} {
  const unknown = assessment.severity === 'unknown';
  const critical = assessment.severity === 'critical';
  const decisions: LaunchMemoryDecision[] = ['cancel', 'retry', 'settings'];
  const buttons = ['Cancelar inicio', 'Volver a comprobar', 'Opciones de Windows'];
  if (
    assessment.severity === 'warning' &&
    assessment.recommendedMiB !== null &&
    assessment.recommendedMiB < assessment.configuredMiB
  ) {
    decisions.splice(1, 0, 'adjust');
    buttons.splice(1, 0, 'Usar RAM recomendada');
  }
  if (unknown) {
    decisions.splice(2, 1, 'continue');
    buttons.splice(2, 1, 'Continuar sin comprobar');
  }
  const explanation = unknown
    ? text(
        'No se pudo consultar la memoria comprometida de Windows. Battly no puede confirmar si hay margen para iniciar Minecraft.',
      )
    : critical
      ? text(
          'Windows está cerca de su límite de memoria comprometida. Minecraft no se iniciará hasta que haya margen suficiente, aunque quede RAM física libre.',
        )
      : text(
          'La RAM máxima configurada supera el margen actual o queda muy poca RAM física libre. Ese máximo no está usado todavía, pero Minecraft podría fallar al crecer.',
        );
  const detail = [explanation];
  if (!unknown) {
    detail.push(
      `${text('Margen de memoria comprometida')}: ${assessment.availableCommitMiB} MiB\n${text('RAM física disponible')}: ${assessment.physicalAvailableMiB} MiB\n${text('Máximo de Minecraft')}: ${assessment.configuredMiB} MiB`,
    );
    if (decisions.includes('adjust')) {
      detail.push(
        `${text('Máximo recomendado para este inicio')}: ${assessment.recommendedMiB} MiB. ${text('Los ajustes guardados no cambiarán.')}`,
      );
    }
    detail.push(
      text(
        'Cierra aplicaciones o Minecrafts que no uses y vuelve a comprobar. En Windows: Rendimiento → Configuración → Opciones avanzadas → Memoria virtual; selecciona un tamaño administrado por el sistema.',
      ),
    );
  }
  return {
    decisions,
    options: {
      type: 'warning',
      title: text('Battly · Comprobación de memoria'),
      message: text(
        critical
          ? 'No hay margen suficiente para iniciar Minecraft'
          : unknown
            ? 'No se pudo comprobar la memoria'
            : 'Revisa la memoria antes de jugar',
      ),
      detail: detail.join('\n\n'),
      buttons: buttons.map(text),
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    },
  };
}
