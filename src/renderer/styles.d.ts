declare module '*.css';

declare module '*.html?raw' {
  const markup: string;
  export default markup;
}

declare module '*.png?url' {
  const url: string;
  export default url;
}

declare module '*.mp3?no-inline' {
  const url: string;
  export default url;
}

declare module '*.webm?url' {
  const url: string;
  export default url;
}
