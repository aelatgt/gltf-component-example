/**
 * Sets up a three.js scene within a GLB.
 * - a polyhedral object that is changed via buttons
 * - a button to toggle through shapes
 * - a button to scale the object
 * 
 * Demonstrates how to have the data for the object synchronized across clients.  
 * This is done by creating a non-persistent networked object at the root of the scene
 * that communicates the changes.  As long as someone is in the room, the state remains
 * but when the last person leaves, the state object is removed and thus resets 
 * when the next person enters.
 * 
 * There is no current way to persist the manipulation state.  To do that would require:
 * - an external server we could save that data to (likely solution for visualizing external sources)
 * - changing the hubs client to include these features in the imported media object, which we
 *   don't want to do
 */


AFRAME.registerComponent('drag-scale', {
  init: function () {
    // This will hold the cursor performing the drag, if any
    this.dragCursor = null 
    // Position of the cursor on the previous frame. Useful for determining speed of the drag
    this.prevPosition = new THREE.Vector3() 
    this.scaleMax = new THREE.Vector3(1.5, 1.5, 1.5);
    this.scaleMin = new THREE.Vector3(.5, .5, .5);

    // wait till first tick to ensure things are fully set up
    this.hoverShape = null;

    // Set up handlers for those events we enabled earlier
    this.el.object3D.addEventListener('holdable-button-down', ({ object3D }) => {
        this.dragCursor = object3D
        this.prevPosition.copy(object3D.position)
    })
    this.el.object3D.addEventListener('holdable-button-up', () => {
        this.dragCursor = null
    })
  },

  tick: function () {
    // don't get hoverShape till first frame
    if (!this.hoverShape) {
        this.hoverShape = this.el.parentNode.components["hover-shape"];
    }

    // If any cursor is held down...
    if (this.dragCursor) {
      // Compute change in cursor vertical position
      // NOTE: should change this to always computer from first frame to now
      // to avoid compounding of error
      const dy = this.dragCursor.position.y - this.prevPosition.y;
       
      let currScale = this.hoverNode.counter.data.scale

      //Update the scale of the object as the vertical change in the cursor position.
      currScale.y = currScale.y + dy;
      currScale.x = currScale.x + dy;
      currScale.z = currScale.z + dy;
      if (currScale.y > this.scaleMax.y) {
            currScale.x = this.scaleMax.x
            currScale.y = this.scaleMax.y
            currScale.z = this.scaleMax.z      
      } else if (currScale.y < this.scaleMin.y) {
            currScale.x = this.scaleMin.x
            currScale.y = this.scaleMin.y
            currScale.z = this.scaleMin.z          
      }
      // assumes it is under an entity with the hover-shape component
      this.hoverShape.setScale(currScale);

      // Store cursor position for next frame.
      this.prevPosition.copy(this.dragCursor.position)
    }
  },
})

//
// Component to create a networked custom entity for inside a glb file.
// The component in the glb should NOT be networked (only the top level glb should),
// the data for this needs to be in a separate entity at the root. 
//
// Networked-AFrame will create a copy of networked entities in any new client, but
// it always creates them at the root of the scene.  And AFrame does not allow entities
// to be moved after they are inserted in the graph (unbelievably).
// 
// The networked entity always has "persistent: false" since this entity only exists for
// the amount of time clients are open in the room.  There is no way in Hubs to persist 
// this data, so it goes away after the last client closes.
//
 AFRAME.registerComponent('hover-shape', {
    init: function () {
        this.SHAPES = ['box', 'cone', 'dodecahedron', 'octahedron', 'sphere', 'torus', 'tetrahedron'];
        this.index = 0;

        // get the parent networked entity, when it's finished initializing.  
        // When creating this as part of a GLTF load, the 
        // parent a few steps up will be networked.
        this.netEntity = null

        // CREATE OUR CONTENT
        this.createMainElement()
        this.createMenus()

        // bind callbacks
        this.nextShape = this.nextShape.bind(this)
        this.setScale = this.setScale.bind(this)

        // Forward the 'interact' events to our networked entity
        this.box2.object3D.addEventListener('interact', this.nextShape)

        // This function finds an existing copy of the Networked Entity (if we are not the
        // first client in the room it will exist in other clients and be created by NAF)
        // or create an entity if we are first.
        this.setupNetworkedEntity = function (networkedEl) {
            var netId;
            if (networkedEl) {
                // We will be part of a Networked GLTF if the GLTF was dropped on the scene
                // or pinned and loaded when we enter the room.  Use the networked parents
                // networkId plus a disambiguating bit of text to create a unique Id.
                netId = NAF.utils.getNetworkId(networkedEl) + "-hover";
            } else {
                // this only happens if this component is on a scene file, since the
                // elements on the scene aren't networked.  So let's assume each entity in the
                // scene will have a unique name.  Adding a bit of text so we can find it
                // in the DOM when debugging.
                netId = this.el.parentNode.parentNode.className + "-hover"
            }

            // check if the networked entity we create for this component already exists. 
            // otherwise, create it
            // - NOTE: it is created on the scene, not as a child of this entity, because
            //   NAF creates remote entities in the scene.
            var entity;
            if (NAF.entities.hasEntity(netId)) {
                entity = NAF.entities.getEntity(netId);
            } else {
                entity = document.createElement('a-entity')

                // the "networked" component should have persistent=false, the template and 
                // networkId set, and should NOT set owner or creator (the system will do that)
                entity.setAttribute('networked', {
                    template: "#hover-shape-media",
                    persistent: false,
                    networkId: netId
                });
                this.el.sceneEl.appendChild(entity);
            }

            // save a pointer to the networked entity and then wait for it to be fully
            // initialized before getting a pointer to the actual networked component in it
            this.netEntity = entity;
            NAF.utils.getNetworkedEntity(this.netEntity).then(networkedEl => {
                this.counter = networkedEl.components["hover-counter"]
            })
        }
        this.setupNetworkedEntity = this.setupNetworkedEntity.bind(this)

        this.setupNetworked = function () {
            NAF.utils.getNetworkedEntity(this.el).then(networkedEl => {
                this.setupNetworkedEntity(networkedEl)
            }).catch(() => {
                this.setupNetworkedEntity()
            })
        }
        this.setupNetworked = this.setupNetworked.bind(this)

        // This method handles the different startup cases:
        // - if the GLTF was dropped on the scene, NAF will be connected and we can 
        //   immediately initialize
        // - if the GLTF is in the room scene or pinned, it will likely be created
        //   before NAF is started and connected, so we wait for an event that is
        //   fired when Hubs has started NAF
        if (NAF.connection && NAF.connection.isConnected()) {
            this.setupNetworked();
        } else {
            this.el.sceneEl.addEventListener('didConnectToNetworkedScene', this.setupNetworked)
        }
    },
 
    createMainElement: function () {
        const geom = document.createElement('a-entity')
        this.geom = geom
        this.geom.setAttribute('position', { x: 0, y: 0, z: 0 })
        this.geom.setAttribute("scale", { x: 0.5, y: 0.5, z: 0.5});

        // Give it a red standard material
        this.geom.setAttribute('material', { color: 'blue' })
        this.geom.setAttribute('geometry', { primitive: this.SHAPES[0] })
        this.el.appendChild(geom)        
    },

    createMenus: function () {
        const box1 = document.createElement('a-box')
        this.box1 = box1
        box1.setAttribute('position', { x: 0.75, y: 0, z: 0 })
        box1.setAttribute("scale", { x: 0.2, y: 0.2, z: 0.2});
        box1.setAttribute('material', { color: 'red' })
        box1.setAttribute('drag-scale','')
        box1.setAttribute('is-remote-hover-target','')
        box1.setAttribute('tags', {isHoldable: true,  holdableButton: true})
        box1.setAttribute('class', "interactable")
        this.el.appendChild(box1)        

        const box2 = document.createElement('a-box')
        this.box2 = box2
        box2.setAttribute('position', { x: -0.75, y: 0, z: 0 })
        box2.setAttribute("scale", { x: 0.2, y: 0.2, z: 0.2});
        box2.setAttribute('material', { color: 'green' })
        box2.setAttribute('is-remote-hover-target','')
        box2.setAttribute('tags', {singleActionButton: true})
        box2.setAttribute('class', "interactable")
        this.el.appendChild(box2)        
    },

    // These methods are called from our interaction objects above
    // and then set the appropriate data on the networked object.  Essentially,
    // you should put whatever state NEEDS to be replicated in the network
    // entity, and compute the rest in each client.
    setScale: function(scale) {
        this.counter.setScale(scale)
    },

    // aren't using it right now, but could
    setRotation: function(rotation) {
        this.counter.setRotation(rotation)
    },

    nextShape: function() {
        var newIndex = (this.index + 1) % this.SHAPES.length;
        this.counter.onNext(newIndex)
    },

    // handle shutdown, such as when a GLTF is deleted from a room.
    remove: function() {
        this.el.object3D.removeEventListener("interact", this.nextShape)
    },

    tick: function () {
        // if we haven't finished setting up the networked entity don't do anything.
        // we COULD do some things (like the motion at the bottom) as long as they
        // don't rely on networked data
        if (!this.netEntity || !this.counter) { return }

        // if the index of the shape changed in the networked data, update our shape
        if (this.counter.index != -1 && this.index != this.counter.index) {
            this.index = this.counter.index;
            this.geom.setAttribute('geometry', 'primitive', this.SHAPES[this.index]);
        }

        // make sure the rotation and scale from the networked object are synchronized with our geometry object
        let scale = this.counter.data.scale
        this.geom.object3D.scale.copy(scale)

        // aren't actually using rotation here, but could
        let rotation = this.counter.data.rotation
        this.geom.object3D.rotation.copy(rotation)

        // This is one way simply way to get the hovering effect on the entity.  If could be
        // done at the top before we check on the networked state
		this.geom.setAttribute('position', this.geom.object3D.position.x + ', ' + 
                (.75 + Math.sin(Date.now() / 500) * .25) + ', ' + this.geom.object3D.position.z);
	},
 
});

//
// Component for our networked state.  This component does nothing except all us to 
// change the state when appropriate. We could set this up to signal the component above when
// something has changed, instead of having the component above poll each frame.
//

AFRAME.registerComponent('hover-counter', {
    schema: {
        index: {default: 0},
        scale: {type: 'vec3', default: { x: 1, y: 1, z: 1}},
        rotation: {type: 'vec3', default: { x: 0, y: 0, z: 0}}
    },
    init: function () {
        this.onNext = this.onNext.bind(this);
        this.setRotation = this.setRotation.bind(this)
        this.setScale = this.setScale.bind(this)

        this.index = -1;
    },

    update() {
        this.index = this.data.index;
    },

    // it is likely that applyPersistentSync only needs to be called for persistent
    // networked entities, so we _probably_ don't need to do this.  But if there is no
    // persistent data saved from the network for this entity, this command does nothing.
    play() {
        if (this.el.components.networked) {
            // not sure if this is really needed, but can't hurt
            if (APP.utils) { // temporary till we ship new client
                APP.utils.applyPersistentSync(this.el.components.networked.data.networkId);
            }
        }
    },

    // The key part in these methods (which are called from the component above) is to
    // check if we are allowed to change the networked object.  If we own it (isMine() is true)
    // we can change it.  If we don't own in, we can try to become the owner with
    // takeOwnership(). If this succeeds, we can set the data.  
    //
    // NOTE: takeOwnership ATTEMPTS to become the owner, by assuming it can become the
    // owner and notifying the networked copies.  If two or more entities try to become
    // owner,  only one (the last one to try) becomes the owner.  Any state updates done
    // by the "failed attempted owners" will not be distributed to the other clients,
    // and will be overwritten (eventually) by updates from the other clients.   By not
    // attempting to guarantee ownership, this call is fast and synchronous.  Any 
    // methods for guaranteeing ownership change would take a non-trivial amount of time
    // because of network latencies.
    setScale(scale) {
        if (!NAF.utils.isMine(this.el) && !NAF.utils.takeOwnership(this.el)) return;

        this.el.setAttribute("hover-counter", "scale", scale);
    },

    setRotation(rotation) {
        if (!NAF.utils.isMine(this.el) && !NAF.utils.takeOwnership(this.el)) return;

        this.el.setAttribute("hover-counter", "rotation", rotation);
    },

    onNext(modelIndex) { //Update the geometry primitive on click event
        if (!NAF.utils.isMine(this.el) && !NAF.utils.takeOwnership(this.el)) return;

        this.el.setAttribute("hover-counter", "index", modelIndex);
    }
});

// Add our template for our networked object to the a-frame assets object,
// and a schema to the NAF.schemas.  Both must be there to have custom components work
const assets = document.querySelector("a-assets");
assets.insertAdjacentHTML(
    'beforeend',
    `
    <template id="hover-shape-media">
      <a-entity
        hover-counter
      ></a-entity>
    </template>
  `
  )

const vectorRequiresUpdate = epsilon => {
		return () => {
			let prev = null;
			return curr => {
				if (prev === null) {
					prev = new THREE.Vector3(curr.x, curr.y, curr.z);
					return true;
				} else if (!NAF.utils.almostEqualVec3(prev, curr, epsilon)) {
					prev.copy(curr);
					return true;
				}
				return false;
			};
		};
	};

NAF.schemas.add({
  	template: "#hover-shape-media",
    components: [
    {
        component: "hover-counter",
        property: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
    },
    {
        component: "hover-counter",
        property: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
    },
    {
      	component: "hover-counter",
      	property: "index"
    }
    ],
  });

// Register our component with the GLTFModelPlus, so it can be loaded as a child
// of a glTF.  This is the only way in Hubs to get objects with arbitrary content loaded
AFRAME.GLTFModelPlus.registerComponent('hover-shape', 'hover-shape')
