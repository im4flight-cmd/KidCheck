# Putting the check-in display online (about 5 minutes)

This is the one part that has to be a person, because it signs you in and holds
the church's ChMS password. It is free and it is quick. Follow it top to bottom.

You can do this in two passes if you like:

- **Pass 1, preview:** get it live today in demo mode with make-believe names,
  just to see it working. No ChMS credentials needed.
- **Pass 2, real:** when your admin sends the ChMS credentials, paste them in
  and it shows real check-ins. Same app, three values added.

---

## Pass 1: get it live (demo mode)

1. Go to **https://vercel.com** and click **Sign Up**. Choose **Continue with
   GitHub** and sign in with the same GitHub you use for the church code. Approve
   the prompts. This is the account creation, once and done.

2. Click **Add New... > Project**.

3. Find **KidCheck** in the list and click **Import**.
   - If you do not see it, click **Adjust GitHub App Permissions** (or
     **Configure GitHub App**) and give Vercel access to the `im4flight-cmd`
     organization. Since KidCheck is a private church repo, an organization
     owner may need to approve that. That is the same admin who has the ChMS
     credentials, so ask them to approve if it asks.

4. Vercel will say the framework is **Next.js**. Leave all the build settings
   exactly as they are.

5. Open **Environment Variables** and add these two, so the preview shows
   something. Type the name on the left, the value on the right, click **Add**
   after each:

   | Name | Value |
   | --- | --- |
   | `DEMO_MODE` | `true` |
   | `ROOMS` | `[{"id":"101","name":"Nursery"},{"id":"102","name":"Preschool"},{"id":"103","name":"Kindergarten"}]` |

6. Click **Deploy**. Wait about a minute. When it finishes, click the
   screenshot or **Visit** to open your live site.

You now have a real link. Tap a room and you will see the demo roster. Send me
that link and I will confirm it looks right.

---

## Pass 2: switch it to real check-ins

When your admin gives you the three ChMS values, come back to the Vercel project.

1. In the project, go to **Settings > Environment Variables**.

2. **Delete** the `DEMO_MODE` variable (or set its value to `false`). This turns
   off the make-believe names.

3. **Add** these three, from what your admin sent:

   | Name | Value |
   | --- | --- |
   | `CCB_SUBDOMAIN` | the part before `.ccbchurch.com`, for example `countryfaith` |
   | `CCB_API_USER` | the ChMS API username |
   | `CCB_API_PASS` | the ChMS API password |

4. Update `ROOMS` with your real rooms. Each room needs a name and its ChMS
   **event id** (the number in the event's URL inside ChMS). For example:
   `[{"id":"48211","name":"Nursery"},{"id":"48212","name":"Preschool"}]`.
   If you are not sure of the event ids, send me what you have and I will help.

5. Go to the **Deployments** tab, open the most recent one, and click the
   **...** menu, then **Redeploy**, so the new settings take effect.

That is it. The link now shows live check-ins.

---

## Then, on each classroom iPad

1. Open the room's link in Safari, for example
   `https://your-site.vercel.app/room/48211`.
2. Tap the **Share** icon, then **Add to Home Screen**. It installs with the CFC
   icon and opens full screen.
3. Open it from the home screen, then turn on **Guided Access** so a teacher
   cannot leave the page. Settings > Accessibility > Guided Access, then triple
   click the side button on the display to lock it.

## If anything looks off

Send me the link and a quick note on what you see. Common ones:

- **"No classrooms yet"** means the `ROOMS` value did not save. Recheck step 5.
- **"ChMS rejected the API credentials"** means a typo in `CCB_API_USER` or
  `CCB_API_PASS`.
- **A room shows no one all service** can mean the event id is wrong, or that
  room simply has no check-ins yet.
