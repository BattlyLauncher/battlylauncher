export function mountProfileEditor(root: HTMLElement): void {
  const modal = root.querySelector<HTMLElement>('#b-profile-customization-modal');
  if (!modal) {
    return;
  }
  const preview = modal.querySelector('#preview-card');
  modal.classList.add('profile-editor-modal');
  modal.innerHTML = /* HTML */ `<div class="modal-background"></div>
    <section
      class="profile-editor-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-editor-title"
    >
      <header>
        <div>
          <h2 id="profile-editor-title">Personalizar perfil</h2>
          <p>Así te verán tus amigos en Battly Social.</p>
        </div>
        <button
          type="button"
          id="b-profile-modal-close"
          aria-label="Cerrar"
        >
          ×
        </button>
      </header>
      <div class="profile-editor-body">
        <aside class="profile-editor-preview">
          <span>VISTA PREVIA</span>
          <div data-preview-slot></div>
          <p>Los cambios se aplican al guardar.</p>
        </aside>
        <div class="pc2-editor-wrap">
          <fieldset>
            <legend>Colores</legend>
            <div class="profile-color-grid">
              <label
                >Nombre<input
                  type="color"
                  id="name-color-picker"
                  value="#ffffff"
              /></label>
              <label
                >Fondo<input
                  type="color"
                  id="bg-color-picker"
                  value="#2c2f33"
              /></label>
              <label
                >Borde<input
                  type="color"
                  id="border-color-picker"
                  value="#7289da"
              /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Borde de la tarjeta</legend>
            <label
              >Estilo<select id="border-style-select">
                <option value="solid">Continuo</option>
                <option value="dashed">Guiones</option>
                <option value="dotted">Puntos</option>
                <option value="double">Doble</option>
                <option value="groove">Relieve interior</option>
                <option value="ridge">Relieve exterior</option>
              </select></label
            >
            <label
              >Grosor <output id="border-width-value">3</output> px<input
                type="range"
                id="border-width-slider"
                min="1"
                max="10"
                step="1"
                value="3"
            /></label>
          </fieldset>
          <fieldset>
            <legend>Imagen de fondo <small>Battly+</small></legend>
            <button
              type="button"
              id="bg-image-label"
            >
              <i
                class="fa-solid fa-image"
                aria-hidden="true"
              ></i>
              Elegir imagen
            </button>
            <p data-profile-premium-note></p>
            <div
              id="current-bg-preview"
              hidden
            >
              <img
                id="current-bg-img"
                alt="Fondo actual"
              /><button
                type="button"
                id="remove-bg-btn"
              >
                <i
                  class="fa-solid fa-trash"
                  aria-hidden="true"
                ></i>
                Quitar imagen
              </button>
            </div>
          </fieldset>
          <footer>
            <button
              type="button"
              id="reset-customization-btn"
            >
              <i
                class="fa-solid fa-rotate-left"
                aria-hidden="true"
              ></i>
              Restablecer</button
            ><button
              type="submit"
              id="save-customization-btn"
            >
              <i
                class="fa-solid fa-check"
                aria-hidden="true"
              ></i>
              Guardar cambios
            </button>
          </footer>
        </div>
      </div>
    </section>`;
  if (preview) {
    modal.querySelector('[data-preview-slot]')?.append(preview);
  }
}
