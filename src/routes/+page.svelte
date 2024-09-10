<!-- src/routes/vr-pdf-reader/+page.svelte -->
<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import * as BABYLON from 'babylonjs';
	import 'babylonjs-loaders';

	let canvas;
	let vrPDFReader;
	let pdfjsLib;
	let isVRAvailable = false;
	let isInVR = false;

	// Promise.withResolvers polyfill
	if (typeof Promise.withResolvers === 'undefined') {
		if (typeof window !== 'undefined') {
			window.Promise.withResolvers = () => {
				let resolve, reject;
				const promise = new Promise((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			};
		} else {
			global.Promise.withResolvers = () => {
				let resolve, reject;
				const promise = new Promise((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve, reject };
			};
		}
	}

	class VRPDFReader {
		constructor(canvas) {
			this.canvas = canvas;
			this.engine = new BABYLON.Engine(this.canvas, true);
			this.scene = new BABYLON.Scene(this.engine);
			this.pdfDoc = null;
			this.currentPage = 1;
			this.pdfTexture = null;
			this.pdfMesh = null;
			this.isFlipping = false;
		}

		async initialize() {
			const camera = new BABYLON.ArcRotateCamera(
				'camera',
				-Math.PI / 2,
				Math.PI / 2.5,
				3,
				new BABYLON.Vector3(0, 0, 0),
				this.scene
			);
			camera.attachControl(this.canvas, true);
			new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);

			if (isVRAvailable) {
				const xrHelper = await this.scene.createDefaultXRExperienceAsync({
					floorMeshes: [
						BABYLON.MeshBuilder.CreateGround('ground', { width: 6, height: 6 }, this.scene)
					]
				});

				if (xrHelper.baseExperience) {
					xrHelper.baseExperience.onStateChangedObservable.add((state) => {
						if (state === BABYLON.WebXRState.IN_XR) {
							isInVR = true;
						} else if (state === BABYLON.WebXRState.NOT_IN_XR) {
							isInVR = false;
						}
					});

					this.setupControllers(xrHelper);
					this.setupExitVRButton(xrHelper);
				} else {
					console.warn('WebXR not available on this device/browser');
				}
			}

			this.pdfMesh = BABYLON.MeshBuilder.CreatePlane(
				'pdfPlane',
				{ width: 1.5, height: 2 },
				this.scene
			);
			this.pdfMesh.position.z = 2;

			this.engine.runRenderLoop(() => {
				this.scene.render();
			});

			window.addEventListener('resize', () => {
				this.engine.resize();
			});
		}

		setupControllers(xrHelper) {
			xrHelper.input.onControllerAddedObservable.add((controller) => {
				controller.onMotionControllerInitObservable.add((motionController) => {
					const xr_ids = motionController.getComponentIds();
					// biome-ignore lint/complexity/noForEach: <explanation>
					xr_ids.forEach((id) => {
						const component = motionController.getComponent(id);
						component.onButtonStateChangedObservable.add((component) => {
							if (component.pressed) {
								if (component.id === 'xr-standard-trigger') {
									if (motionController.handness === 'left') {
										this.prevPage();
									} else {
										this.nextPage();
									}
								}
							}
						});
					});
				});
			});
		}

		setupExitVRButton(xrHelper) {
			const exitVRButton = BABYLON.GUI.Button.CreateSimpleButton('exitVR', 'Exit VR');
			exitVRButton.width = '150px';
			exitVRButton.height = '40px';
			exitVRButton.color = 'white';
			exitVRButton.cornerRadius = 20;
			exitVRButton.background = 'green';
			exitVRButton.onPointerUpObservable.add(() => {
				xrHelper.baseExperience.exitXRAsync();
			});

			const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
			advancedTexture.addControl(exitVRButton);
			exitVRButton.isVisible = false;

			xrHelper.baseExperience.onStateChangedObservable.add((state) => {
				exitVRButton.isVisible = state === BABYLON.WebXRState.IN_XR;
			});
		}

		async loadPDF(url) {
			const loadingTask = pdfjsLib.getDocument(url);
			this.pdfDoc = await loadingTask.promise;
			await this.renderPage(1);
		}

		async renderPage(num) {
			if (this.isFlipping) return;
			this.isFlipping = true;

			const page = await this.pdfDoc.getPage(num);
			const scale = 1.5;
			const viewport = page.getViewport({ scale });

			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			canvas.height = viewport.height;
			canvas.width = viewport.width;

			const renderContext = {
				canvasContext: context,
				viewport: viewport
			};
			await page.render(renderContext).promise;

			const newTexture = new BABYLON.DynamicTexture(
				'pdfTexture',
				{ width: canvas.width, height: canvas.height },
				this.scene
			);
			const ctx = newTexture.getContext();
			ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
			newTexture.update();

			// Create a new material for the new page
			const newMaterial = new BABYLON.StandardMaterial('pdfMaterial', this.scene);
			newMaterial.diffuseTexture = newTexture;

			// Create a new mesh for the new page
			const newMesh = BABYLON.MeshBuilder.CreatePlane(
				'pdfPlane',
				{ width: 1.5, height: 2 },
				this.scene
			);
			newMesh.material = newMaterial;

			// Position the new mesh
			newMesh.position = this.pdfMesh.position.clone();
			if (num > this.currentPage) {
				newMesh.position.x += 1.5;
			} else {
				newMesh.position.x -= 1.5;
			}

			// Animate the page turn
			const animationDuration = 500;
			BABYLON.Animation.CreateAndStartAnimation(
				'turnPage',
				this.pdfMesh,
				'position',
				60,
				animationDuration / (1000 / 60),
				this.pdfMesh.position,
				newMesh.position,
				BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
			);

			await new Promise((resolve) => setTimeout(resolve, animationDuration));

			// Clean up
			if (this.pdfTexture) {
				this.pdfTexture.dispose();
			}
			if (this.pdfMesh) {
				this.pdfMesh.dispose();
			}

			this.pdfTexture = newTexture;
			this.pdfMesh = newMesh;
			this.currentPage = num;

			this.isFlipping = false;
		}

		nextPage() {
			if (this.currentPage < this.pdfDoc.numPages) {
				this.renderPage(this.currentPage + 1);
			}
		}

		prevPage() {
			if (this.currentPage > 1) {
				this.renderPage(this.currentPage - 1);
			}
		}
	}

	onMount(async () => {
		if (browser) {
			const pdfjs = await import('pdfjs-dist');
			pdfjsLib = pdfjs;

			pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
				'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
				import.meta.url
			).toString();

			// Check if VR is available
			isVRAvailable = await BABYLON.WebXRSessionManager.IsSessionSupportedAsync('immersive-vr');

			vrPDFReader = new VRPDFReader(canvas);
			await vrPDFReader.initialize();
			await vrPDFReader.loadPDF('/lemon.pdf');
		}
	});
</script>

<canvas bind:this={canvas}></canvas>

{#if !isInVR}
	<div class="non-vr-controls">
		<button on:click={() => vrPDFReader.prevPage()}>Previous Page</button>
		<button on:click={() => vrPDFReader.nextPage()}>Next Page</button>
	</div>
{/if}

<style>
	canvas {
		width: 100%;
		height: 100vh;
	}
	.non-vr-controls {
		position: absolute;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
	}
</style>
