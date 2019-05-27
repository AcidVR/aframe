/* global ImageData, URL */
var registerComponent = require('../../core/component').registerComponent;
var THREE = require('../../lib/three');

var VERTEX_SHADER = [
  'attribute vec3 position;',
  'attribute vec2 uv;',
  'uniform mat4 projectionMatrix;',
  'uniform mat4 modelViewMatrix;',
  'varying vec2 vUv;',
  'void main()  {',
  '  vUv = vec2( 1.- uv.x, uv.y );',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
  '}'
].join('\n');

var FRAGMENT_SHADER = [
  'precision mediump float;',
  'uniform samplerCube map;',
  'varying vec2 vUv;',
  '#define M_PI 3.141592653589793238462643383279',
  'void main() {',
  '  vec2 uv = vUv;',
  '  float longitude = uv.x * 2. * M_PI - M_PI + M_PI / 2.;',
  '  float latitude = uv.y * M_PI;',
  '  vec3 dir = vec3(',
  '    - sin( longitude ) * sin( latitude ),',
  '    cos( latitude ),',
  '    - cos( longitude ) * sin( latitude )',
  '  );',
  '  normalize( dir );',
  '  gl_FragColor = vec4( textureCube( map, dir ).rgb, 1.0 );',
  '}'
].join('\n');

/**
 * Component to take streamcapture6s of the scene using a keboard shortcut (alt+s).
 * It can be configured to either take 360&deg; captures (`equirectangular`)
 * or regular streamcapture6s (`projection`)
 *
 * This is based on https://github.com/spite/THREE.CubemapToEquirectangular
 * To capture an equirectangular projection of the scene a THREE.CubeCamera is used
 * The cube map produced by the CubeCamera is projected on a quad and then rendered to
 * WebGLRenderTarget with an orthographic camera.
 */
module.exports.Component = registerComponent('streamcapture', {
  schema: {
    width: { default: 4096 },
    height: { default: 2048 },
    camera: { type: 'selector' },
    duration: { default: 60000 },
    frameRate: { default: 60 }
  },

  init: function () {
    var el = this.el;
    var self = this;
    self.recordedBlobs = [];

    if (el.renderer) {
      setup();
    } else {
      el.addEventListener('render-target-loaded', setup);
    }

    function handleDataAvailable(event) {
      if (event.data && event.data.size > 0) {
        self.recordedBlobs.push(event.data);
      }
    }

    function startRecording() {
      var canvas = document.querySelector('canvas');
      var stream = canvas.captureStream(self.data.frameRate);
      var options = { mimeType: 'video/webm;codecs=h264' };
      self.mediaRecorder = new MediaRecorder(stream, options);
      self.mediaRecorder.ondataavailable = handleDataAvailable;
      self.mediaRecorder.start(5000); // collect 5000ms of data
    }

    function stopRecording() {
      self.mediaRecorder.stop();
    }

    function setup () {
      var gl = el.renderer.getContext();
      if (!gl) { return; }
      gl.preserveDrawingBuffer = true;
      gl.desynchronized = true;
      self.cubeMapSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
      self.material = new THREE.RawShaderMaterial({
        uniforms: {map: {type: 't', value: null}},
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: THREE.DoubleSide
      });
      self.quad = new THREE.Mesh(
        new THREE.PlaneBufferGeometry(1, 1),
        self.material
      );
      self.quad.visible = true;
      self.quad.layers.set(1);
      self.camera = new THREE.OrthographicCamera(-1 / 2, 1 / 2, 1 / 2, -1 / 2, -1000, 1000);
      el.object3D.add(self.quad);

      // Create cube camera and copy position from scene camera.
      self.cubeCamera = new THREE.CubeCamera(el.camera.near, el.camera.far,
        Math.min(self.cubeMapSize, 2048));
      self.camera.layers.enable( 1 );
      self.camera.layers.set(1);
      self.originalCamera = el.camera;
      el.camera = self.camera;
      // Resize quad, camera, and canvas.
      self.resize(self.data.width, self.data.height);
    }
  },

  tick: function() {
    var el = this.el;
    // Render scene with cube camera.
    // Copy camera position into cube camera;
    this.originalCamera.getWorldPosition(this.cubeCamera.position);
    this.originalCamera.getWorldQuaternion(this.cubeCamera.quaternion);

    this.cubeCamera.update(el.renderer, el.object3D);
    this.quad.material.uniforms.map.value = this.cubeCamera.renderTarget.texture;
  },

  resize: function (width, height) {
    // Resize quad.
    this.quad.scale.set(width, height, 1);

    // Resize camera.
    this.el.camera.left = -1 * width / 2;
    this.el.camera.right = width / 2;
    this.el.camera.top = height / 2;
    this.el.camera.bottom = -1 * height / 2;
    this.el.camera.updateProjectionMatrix();

    this.el.camera.scale.y = -1;
    this.el.camera.updateProjectionMatrix();
  },
});
