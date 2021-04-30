## Sample GLTF Hubs Plugin

This repository contains a script to be attached to a room in Hubs. It defines a component `hover-shape` that can be added to a GLTF for loading in Hubs.  These GLTFs can be dropped on the scene or added to spoke file. 

The script adds content to the GLTF by defining a custom component in Hubs' GLTF loader:
```
AFRAME.GLTFModelPlus.registerComponent('hover-shape', 'hover-shape')
```

This component adds A-Frame/three.js content to the scene under the node created by the GLTF loader.  If your content does not need to have any state synchronized across multiple clients, you can simply put the content you want here, and you are done.

In this example, we create some content that needs to be synchronized.  The "hover shape" has a moving 3D shape, and two small cubes (red and green).  Clicking on the green cube causes the shape to change, cycling through a set of common 3D shapes.  Clicking and dragging on the red cube changes the size of the shape.  This information (the shape and the size ) need to be synchronized across all clients if you want users to see the same thing.

To synchronize, the component creates an entity with a `networked` component called `hover-counter` at the root of the AFrame Scene.  Networked A-Frame (NAF) needs these networked objects to be at the root of the scene, and when a new client joins the room, NAF creates a copy of all the networked objects in that clients AFrame scene (see *Networked Objects in Hubs* for additional discussion of NAF objects in Hubs).  

The script adds a schema to the `<a-assets>` section of the scene. It is used when we create the `networked` component:  the NAF system adds all the content in that schema to the entity the `networked` component is added to (the entity in the schema is the entity the `networked` component was added to, which would allow additional components to be added to that entity).  In this case, we only add our `hover-counter` component to the entity.

The script also adds a `NAF.schema` which tells NAF which components (and which properties on those components) should be synchronized between different clients.  Whenever one of those components is changed by the object owner, the changes are sent everywhere.

You will notice that all we do in the networked component is manage the networked data.  This choice is arbitrary, but it separates the networking and the GLTF object logic in a reasonable way.  Other details of the way we've set this up, and why, are in the comments in the code.

In the content we create, if we want the user to interact with any of it, we must put certain attributes on the entity. The `geom` entity cannot be interacted with, so it has no special attributes.  For `box1` (the red box), we add:
```
        box1.setAttribute('is-remote-hover-target','')
        box1.setAttribute('tags', {isHoldable: true,  holdableButton: true})
        box1.setAttribute('class', "interactable")
```
which says it's interactive and can be held if we click and don't release the button or wand.  The `drag-scale` component on this object listens for events for the start and end of a drag motion, and changes the size of the geometry object appropriately.

For `box2` (the green box), we add:
```
        box2.setAttribute('is-remote-hover-target','')
        box2.setAttribute('tags', {singleActionButton: true})
        box2.setAttribute('class', "interactable")
```
which says it's interactive and can be clicked on. We add an object listener for "interact" events on the object3D of `box2`.

Because these objects are part of a Hubs GLTF, they behave like other GLTFs. For non-scene objects, pointing at any non-interactive 3D content (the geometry object) will cause all of the GLTFs content to highlight; pressing the appropriate key while the object is highlighted will bring up the object menu (to move, scale, pin, destroy, drop, refresh, download, or clone the object).  Pointing at the interactive boxes will turn the cursor blue. 

#### Networked Objects in Hubs.

In this section, we provide some additional details of how NAF and Hubs work.  

Each networked object has a notion of a creator and an owner. Only the owner can change the state of the networked data;  if any other client changes the state, it will not be sent to other clients (and will be overridden by incoming changes).  At the start of each method that might change the networked data, we have the line:
```
        if (!NAF.utils.isMine(this.el) && !NAF.utils.takeOwnership(this.el)) return;
```

The `NAF.utils.isMine()` method checks if we own the object.  The `NAF.utils.takeOwnership()` attempts to acquire ownership. This command assumes it can take ownership (except in certain situations), and either returns true or false accordingly.  If multiple clients try to take ownership at the same time, NAF picks one of them to be the new owner.  When the update data is sent out by the new owner, the other "possible owners" will have their updates overridden, and will be told they aren't the owner.

There are two sorts of NAF entities, "persistent" and "non-persistent", chosen by the `persistent` property set when creating the `networked` component.  Roughly speaking, persistent objects are created simultaneously by all clients from information they have, so the scene objects and pinned objects are designated as persistent and created by each Hubs client from information provided by the server about the room.  As long as they have the same `networkId`, they will remain synchronized.  Non-persistent objects are assumed to not be saved when the room closes (when all clients leave), and created by one of the clients during the networked session.  In Hubs, this happens when content is dropped on the scene (or picked from the object menu).  These objects are created by NAF in each new client.  

Non-persistent objects are the typical sort of objects we would create, since we do not have the ability to store the state of our object inside hubs;  if we used an external server to store the state of the object, and each client connected to that server to retrieve the state and create a copy of the object, we could use persistent objects.  But, even then, we probably want to use non-persistent objects and only retrieve the state of the object in the first client that connects, when it creates the NAF entity.

Each networked object must have a unique `networkId`.  If the object is persistent each client must have some what to determine the common, unique id.  For hubs, those id's are built into the scene, or passed with the pinned objects.  If the object is not persistent, it is created in one client, and NAF takes care of creating a duplicate in each other client.  For this to happen, the object asset schema and the `NAF.schema` must be defined the same in all clients.

The creation flow in the `hover-shape.init()` method takes care of the various cases encountered in Hubs. Components could be created before, or after, NAF is initialized: the `if` statement at the bottom of the method either creates the `networked` object (if NAF is ready) or waits for it to be ready.  The `setupNetworked()` method checks if the GLTF object the `hover-shape` component is attached to is networked or not.  GLTF's place in the scene in spoke are not networked, because they cannot be moved or deleted.  Pinned GLTFs or GLTFs that have been dropped on the room are networked, and thus will have a `neetworkId`;  the `NAF.utils.getNetworkedEntity()` method searches up the scene to the root, looking for a networked ancestor of the component, and raises and exception if it doesn't find one.

The `setupNetworkedEntity()` method takes care of finding, or creating, the networked `hover-counter` for this component. If the GLTF is networked, then there will be an entity above this component's entity that has a unique `networkId`; we take this entities unique id and append `-hover` to it to create another unique id.  If there is not networked entity, than the GLTF should have a name that was assigned in Spoke.  While spoke does not require entity names to be unique, if this case, we assume it is, so we take the name and also add `-hover` (so we can find it in the DOM when debugging).  (To be more robust, we could keep track of the components in the scene GLTF and have some way of disambiguating duplicate names, such as incrementing a counter.)

Finally, we save a pointer to the existing networked entity, or create a new one.  In both cases, we wait for it to be completely initialized, and then save pointer to its `hover-count` component. We will use this though the code to communicate between the two components; we set this communication up as one-way, but would could have provided the `hover-count` component a link to the `hover-shape` component as well, to let it call directly to update changed data.

#### Usage

The components necessary are the drag-rotate component, the single-action-button component, which is from Matt's https://github.com/aelatgt/hubs-scripting-guide tutorial, and the hover-shape component.
The hover-shape-combined.js file registers all of these components, as well as registers the new template which depends on them, and adds an a-entity with the template to a
scene. These are based off of the examples within hubs-scripting-guide.

To inject this script into a Hubs room:
1. Copy the link to the script being served statically on GitHub Pages: https://www.aelatgt.org/hover-shape-component/scripts/hover-shape-combined.js
2. Paste in the Custom Scripts in Room Settings of a Hubs Room and hit Apply.
3. Reload the Hubs room
4. Drag the hover-controller.glb and the hover-shape.glb files into the room to place them.
5. Now the entity will change shape when the controller is pressed.
Note: As of now the position of the cube is fixed, so you may want to test on the WideOpenSpace scene or other less busy scenes that spawn you near the origin.
